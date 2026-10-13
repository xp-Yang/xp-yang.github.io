const TILE_SIZE = 64;
const BYTES_PER_BODY = 16;
const GPU_WAIT_TIMEOUT_MS = 5000;
const ALLOCATION_ERROR_SCOPES = ['validation', 'out-of-memory', 'internal'];
const DISPATCH_ERROR_SCOPES = ['validation'];

const FORCE_SHADER = /* wgsl */ `
struct Parameters {
  count: u32,
  gm: f32,
  padding: vec2<u32>,
}

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> accelerations: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> parameters: Parameters;

var<workgroup> tile: array<vec4<f32>, ${TILE_SIZE}>;

@compute @workgroup_size(${TILE_SIZE})
fn main(@builtin(global_invocation_id) global_id: vec3<u32>,
        @builtin(local_invocation_id) local_id: vec3<u32>) {
  let body = global_id.x;
  let lane = local_id.x;
  let is_active = body < parameters.count;
  var position = vec3<f32>(0.0);
  if (is_active) { position = positions[body].xyz; }
  var acceleration = vec3<f32>(0.0);
  var compensation = vec3<f32>(0.0);
  var invalid = 0.0;

  for (var base = 0u; base < parameters.count; base += ${TILE_SIZE}u) {
    let source = base + lane;
    if (source < parameters.count) { tile[lane] = positions[source]; }
    else { tile[lane] = vec4<f32>(0.0); }
    // Inactive lanes still load and reach both barriers in the final workgroup.
    workgroupBarrier();
    if (is_active) {
      let length = min(${TILE_SIZE}u, parameters.count - base);
      for (var k = 0u; k < length; k++) {
        if (base + k != body) {
          let delta = tile[k].xyz - position;
          let distance2 = dot(delta, delta);
          if (distance2 > 0.0 && distance2 <= 3.402823e38) {
            // Newtonian gravity, with no softening or distance clamp.
            // Normalize first so d^3 need not fit in f32 for distant pairs.
            let magnitude = parameters.gm / distance2;
            let contribution = (delta * (1.0 / sqrt(distance2))) * magnitude;
            if (magnitude == 0.0) { invalid = 2.0; }
            // Compensated summation reduces f32 cancellation across the full sum.
            let corrected = contribution - compensation;
            let sum = acceleration + corrected;
            compensation = (sum - acceleration) - corrected;
            acceleration = sum;
          } else {
            // Reject collapsed centres and unrepresentable squared distances.
            invalid = select(2.0, 1.0, distance2 == 0.0);
          }
        }
      }
    }
    workgroupBarrier();
  }
  if (is_active) { accelerations[body] = vec4<f32>(acceleration, invalid); }
}
`;

function forceError(message, cause) {
  const error = new Error(message);
  error.name = 'WebGPUForceError';
  if (cause) error.cause = cause;
  return error;
}

function destroyBuffers(buffers) {
  if (!buffers) return;
  buffers.positions?.destroy();
  buffers.accelerations?.destroy();
  buffers.readback?.destroy();
}

function boundedGPURequest(operation, label, onLateValue) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(forceError(`${label} timed out after ${GPU_WAIT_TIMEOUT_MS} ms.`));
    }, GPU_WAIT_TIMEOUT_MS);
    Promise.resolve(operation).then(value => {
      if (settled) {
        // A timed-out requestDevice can still succeed later; release that device.
        try { onLateValue?.(value); } catch { /* The request already failed. */ }
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(forceError(`${label} failed: ${error?.message || String(error)}`, error));
    });
  });
}

/**
 * Creates a tiled all-pairs Newtonian force solver for a window or Web Worker.
 * Inputs/integration remain Float64 on the CPU; GPU input and arithmetic are f32.
 * Await each compute before invoking it again: one readback buffer is reused.
 * Reset/configuration epochs and cancellation of stale results belong to the caller.
 * Any GPU failure throws so the caller can recompute the same state on the CPU.
 */
export async function createWebGPUForceSolver() {
  const gpu = globalThis.navigator?.gpu;
  const usage = globalThis.GPUBufferUsage;
  const mapMode = globalThis.GPUMapMode;
  if (!gpu || !usage || !mapMode) throw forceError('WebGPU is unavailable in this execution context.');
  const adapter = await boundedGPURequest(
    gpu.requestAdapter({ powerPreference: 'high-performance' }), 'WebGPU adapter request');
  if (!adapter) throw forceError('No WebGPU adapter is available.');
  if (adapter.isFallbackAdapter) throw forceError('Only a software WebGPU adapter is available.');
  const device = await boundedGPURequest(
    adapter.requestDevice({ label: 'Gravity force solver' }), 'WebGPU device request', lateDevice => lateDevice.destroy());

  let disposed = false;
  let failure = null;
  let busy = false;
  let buffers = null;
  let capacity = 0;
  let input = new Float32Array(0);
  let uniformBuffer = null;
  let pipeline;
  const failureWaiters = new Set();
  const fail = error => {
    if (!failure) {
      failure = error;
      for (const reject of failureWaiters) reject(error);
      failureWaiters.clear();
    }
  };
  const onUncapturedError = event => {
    event.preventDefault();
    fail(forceError(`WebGPU force solver error: ${event.error.message}`, event.error));
  };
  device.addEventListener('uncapturederror', onUncapturedError);
  device.lost.then(info => {
    if (!disposed) fail(forceError(`WebGPU force solver device lost (${info.reason}): ${info.message}`));
  }, error => fail(forceError('Could not observe the WebGPU device state.', error)));

  function assertUsable() {
    if (disposed) throw forceError('The WebGPU force solver has been disposed.');
    if (failure) throw failure;
  }

  function awaitGPU(operation, label = 'WebGPU operation') {
    const promise = Promise.resolve(operation);
    if (failure || disposed) {
      // The GPU call has already started. Observe its eventual rejection as well.
      promise.catch(() => {});
      return Promise.reject(failure || forceError('The WebGPU force solver has been disposed.'));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        failureWaiters.delete(onFailure);
        if (error) reject(error);
        else resolve(value);
      };
      const onFailure = error => finish(error);
      failureWaiters.add(onFailure);
      timer = setTimeout(() => {
        // A hung GPU wait is fatal; the caller disposes and resumes on the CPU.
        fail(forceError(`${label} timed out after ${GPU_WAIT_TIMEOUT_MS} ms.`));
      }, GPU_WAIT_TIMEOUT_MS);
      promise.then(value => finish(null, value), error => finish(error || forceError(`${label} failed without an error description.`)));
    });
  }

  async function checkedOperation(label, operation, scopes = ALLOCATION_ERROR_SCOPES) {
    assertUsable();
    let result, operationError, pushed = 0;
    try {
      for (const filter of scopes) { device.pushErrorScope(filter); pushed++; }
      result = await awaitGPU(operation(), label);
    }
    catch (error) { operationError = error || forceError(`${label} failed without an error description.`); }
    // Pop every scope even if a synchronous call or mapping failed.
    const pops = [];
    for (let i = 0; i < pushed; i++) {
      try { pops.push(device.popErrorScope()); }
      catch (error) { operationError ||= error || forceError('Could not pop a WebGPU error scope.'); }
    }
    let errors;
    try {
      errors = await awaitGPU(Promise.all(pops), `${label} error scopes`);
    } catch (error) { operationError ||= error || forceError('Could not observe WebGPU error scopes.'); }
    assertUsable();
    const gpuError = errors?.find(error => error);
    if (gpuError) throw forceError(`${label}: ${gpuError.message}`, gpuError);
    if (operationError) throw forceError(`${label}: ${operationError.message || operationError}`, operationError);
    return result;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    fail(forceError('The WebGPU force solver has been disposed.'));
    device.removeEventListener('uncapturederror', onUncapturedError);
    destroyBuffers(buffers);
    buffers = null;
    uniformBuffer?.destroy();
    uniformBuffer = null;
    device.destroy();
  }

  const parameterData = new ArrayBuffer(16);
  const parameterU32 = new Uint32Array(parameterData);
  const parameterF32 = new Float32Array(parameterData);
  let compilationWarnings = [];

  try {
    pipeline = await checkedOperation('WebGPU force shader compilation failed', async () => {
      const module = device.createShaderModule({ label: 'Tiled Newtonian forces', code: FORCE_SHADER });
      const information = await awaitGPU(module.getCompilationInfo(), 'WebGPU shader compilation information');
      const errors = information.messages.filter(message => message.type === 'error');
      if (errors.length) {
        throw forceError(errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n'));
      }
      compilationWarnings = information.messages.filter(message => message.type === 'warning').map(message => message.message);
      return device.createComputePipelineAsync({
        label: 'Tiled all-pairs gravity',
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });
    });
    await checkedOperation('WebGPU force parameter allocation failed', () => {
      uniformBuffer = device.createBuffer({
        label: 'Gravity force parameters', size: 16, usage: usage.UNIFORM | usage.COPY_DST,
      });
    });
  } catch (error) {
    dispose();
    throw error;
  }

  async function reserve(required) {
    if (required <= capacity) return;
    let nextCapacity = Math.max(TILE_SIZE, capacity);
    while (nextCapacity < required) nextCapacity *= 2;
    const byteLimit = Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize);
    if (nextCapacity * BYTES_PER_BODY > byteLimit) nextCapacity = Math.ceil(required / TILE_SIZE) * TILE_SIZE;
    if (nextCapacity * BYTES_PER_BODY > byteLimit
      || Math.ceil(required / TILE_SIZE) > device.limits.maxComputeWorkgroupsPerDimension) {
      throw forceError('The body count exceeds the WebGPU force solver device limits.');
    }
    const byteLength = nextCapacity * BYTES_PER_BODY;
    let allocated;
    try {
      await checkedOperation('WebGPU force buffer allocation failed', () => {
        allocated = {};
        allocated.positions = device.createBuffer({ label: 'Gravity positions', size: byteLength, usage: usage.STORAGE | usage.COPY_DST });
        allocated.accelerations = device.createBuffer({ label: 'Gravity accelerations', size: byteLength, usage: usage.STORAGE | usage.COPY_SRC });
        allocated.readback = device.createBuffer({ label: 'Gravity acceleration readback', size: byteLength, usage: usage.MAP_READ | usage.COPY_DST });
        allocated.bindGroup = device.createBindGroup({
          label: 'Gravity force buffers', layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: allocated.positions } },
            { binding: 1, resource: { buffer: allocated.accelerations } },
            { binding: 2, resource: { buffer: uniformBuffer } },
          ],
        });
      });
      assertUsable();
      const nextInput = new Float32Array(nextCapacity * 4);
      destroyBuffers(buffers);
      buffers = allocated;
      input = nextInput;
      capacity = nextCapacity;
    } catch (error) {
      destroyBuffers(allocated);
      throw error;
    }
  }

  async function compute(positions, count, gm, out = new Float64Array(count * 3)) {
    assertUsable();
    if (busy) throw forceError('WebGPU force computations must be awaited serially.');
    if (!Number.isInteger(count) || count < 0 || count > 0xffffffff
      || positions.length < count * 3 || out.length < count * 3) {
      throw forceError('Invalid positions, output buffer, or body count for WebGPU forces.');
    }
    const gpuGM = Math.fround(gm);
    if (!Number.isFinite(gm) || !Number.isFinite(gpuGM) || (gm !== 0 && gpuGM === 0)) {
      throw forceError('The gravitational mass factor cannot be represented in f32.');
    }
    if (!count || !gm) { out.fill(0); return out; }
    busy = true;
    let activeBuffers;
    try {
      await reserve(count);
      assertUsable();
      activeBuffers = buffers;
      // Translate the cloud before f32 conversion to reduce large world-offset loss.
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < count * 3; i += 3) {
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw forceError('WebGPU force positions must be finite.');
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      const originX = minX * .5 + maxX * .5;
      const originY = minY * .5 + maxY * .5;
      const originZ = minZ * .5 + maxZ * .5;
      for (let i = 0; i < count; i++) {
        const p = i * 3, q = i * 4;
        input[q] = positions[p] - originX;
        input[q + 1] = positions[p + 1] - originY;
        input[q + 2] = positions[p + 2] - originZ;
        if (!Number.isFinite(input[q]) || !Number.isFinite(input[q + 1]) || !Number.isFinite(input[q + 2])) {
          throw forceError('The position range cannot be represented in f32.');
        }
      }
      parameterU32[0] = count;
      parameterF32[1] = gpuGM;
      const byteLength = count * BYTES_PER_BODY;
      await checkedOperation('WebGPU force computation failed', async () => {
        device.queue.writeBuffer(activeBuffers.positions, 0, input.buffer, 0, byteLength);
        device.queue.writeBuffer(uniformBuffer, 0, parameterData);
        const encoder = device.createCommandEncoder({ label: 'Gravity force dispatch' });
        const pass = encoder.beginComputePass({ label: 'Gravity all-pairs sum' });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, activeBuffers.bindGroup);
        pass.dispatchWorkgroups(Math.ceil(count / TILE_SIZE));
        pass.end();
        encoder.copyBufferToBuffer(activeBuffers.accelerations, 0, activeBuffers.readback, 0, byteLength);
        device.queue.submit([encoder.finish()]);
        // Mapping already waits for the copy: no separate queue-wide fence is needed.
        await activeBuffers.readback.mapAsync(mapMode.READ, 0, byteLength);
      }, DISPATCH_ERROR_SCOPES);
      assertUsable();
      const result = new Float32Array(activeBuffers.readback.getMappedRange(0, byteLength));
      // Validate the whole readback before publishing any acceleration to the caller.
      for (let i = 0; i < count; i++) {
        const q = i * 4;
        if (result[q + 3] === 1) throw forceError('Distinct sphere centres coincide after f32 conversion.');
        if (result[q + 3] !== 0) throw forceError('A gravitational interaction exceeds the f32 arithmetic range.');
        if (!Number.isFinite(result[q]) || !Number.isFinite(result[q + 1]) || !Number.isFinite(result[q + 2])) {
          throw forceError('WebGPU returned a non-finite gravitational acceleration.');
        }
      }
      for (let i = 0; i < count; i++) {
        const p = i * 3, q = i * 4;
        out[p] = result[q]; out[p + 1] = result[q + 1]; out[p + 2] = result[q + 2];
      }
      out.fill(0, count * 3);
      return out;
    } finally {
      try { if (activeBuffers) activeBuffers.readback.unmap(); }
      finally { busy = false; }
    }
  }

  return { backend: 'webgpu', precision: 'f32', tileSize: TILE_SIZE, compilationWarnings, compute, dispose };
}

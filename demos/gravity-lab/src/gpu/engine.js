import { createPhysicsShader } from './shaders.js';
import { PARTICLE_RADIUS, PARTICLE_MASS } from '../physics/constants.js';

const STEP = 1 / 60;
const CONTROL_BYTES = 112;
const CAPTURE_HEADER_BYTES = 144;
const MAX_SAMPLES = 24;
const ADVANCE_PARAMETER_SLOTS = 4;
const FREE_ENTRIES = ['kick_drift', 'force_final_kick', 'commit'];
const CCD_ENTRIES = ['ccd_begin', 'ccd_start', 'ccd_build_candidates', 'ccd_finish_build',
  'ccd_scan_min', 'ccd_minimum', 'ccd_scan_ties', 'ccd_select', 'ccd_drift', 'ccd_impact',
  'ccd_prepare_update', 'ccd_retain', 'ccd_participants', 'ccd_finish_update', 'force_final_kick', 'commit'];
const CANDIDATE_ENTRIES = new Set(['ccd_build_candidates', 'ccd_scan_min', 'ccd_minimum',
  'ccd_scan_ties', 'ccd_select', 'ccd_retain', 'ccd_participants']);

function invalid(message) { return new Error(`WebGPU: ${message}`); }

function faultDescription(mask) {
  if (mask & 2) return 'GPU 连续接触无法可靠求解，已保留上一完整物理步并暂停。';
  if (mask & 4) return '单步碰撞事件达到安全上限，已保留上一完整物理步并暂停。';
  if (mask & 8) return 'GPU 计数或时间超出数值范围，已保留上一完整物理步并暂停。';
  if (mask) return 'GPU 状态超出有效数值或空间分辨率，已保留上一完整物理步并暂停。';
  return '';
}

/**
 * A GPU-owned engine on the caller's device. It does not create/destroy the
 * device, depend on CPU Simulation, or read a batch back to schedule its next.
 *
 * Call encodeAdvance at most once per encoder, then submit that encoder before
 * starting another batch. Runtime permits at most two batches in flight. Four
 * parameter slots also protect several encoders prepared before submission.
 * Capture.read() is invoked after the caller submits its encoder; it is an
 * independent promise, not a dependency of the simulation or render loop.
 */
export async function createGpuEngine(device, initial, config) {
  const count = initial.count ?? initial.positions?.length / 3;
  const radius = initial.radius ?? PARTICLE_RADIUS;
  const mass = initial.mass ?? PARTICLE_MASS;
  const startStep = initial.acceptedSteps ?? 0;
  const startTime = initial.time ?? 0;
  const startCollisions = initial.collisions ?? 0;
  const initialLoss = initial.collisionEnergyLoss ?? initial._collisionEnergyLoss ?? 0;
  if (!Number.isInteger(count) || count < 2 || count > 20_000) throw invalid('粒子数量须为 2–20,000。');
  if (!initial.positions || !initial.velocities || initial.positions.length !== count * 3 || initial.velocities.length !== count * 3) {
    throw invalid('初始位置和速度长度不匹配。');
  }
  if (!(radius > 0) || !(mass > 0) || !Number.isFinite(radius) || !Number.isFinite(mass)) throw invalid('初始质量或半径无效。');
  if (!Number.isInteger(startStep) || startStep < 0 || startStep > 0xfffffffe
    || !Number.isInteger(startCollisions) || startCollisions < 0 || startCollisions > 0xffffffff
    || !Number.isFinite(startTime) || startTime < 0 || !Number.isFinite(initialLoss) || initialLoss < 0) {
    throw invalid('初始计数或时间无效。');
  }
  const collisionless = config.collisionless === true;
  const gravity = config.G ?? 1;
  const restitution = config.restitution ?? 1;
  const softeningRatio = config.softeningRatio ?? 1;
  if (!Number.isFinite(gravity) || gravity < 0 || gravity > 10
    || !Number.isFinite(restitution) || restitution < 0 || restitution > 1
    || !Number.isFinite(softeningRatio) || softeningRatio < 0.1 || softeningRatio > 5) {
    throw invalid('引力、恢复系数或软化参数无效。');
  }
  const softening = collisionless ? softeningRatio * radius : 0;
  const maxEvents = Math.max(128, count * 4);
  const sampleCount = Math.min(MAX_SAMPLES, count);
  const tileSize = device.limits.maxComputeInvocationsPerWorkgroup >= 256
    && device.limits.maxComputeWorkgroupSizeX >= 256 ? 256 : 128;
  if (device.limits.maxComputeInvocationsPerWorkgroup < 128 || device.limits.maxComputeWorkgroupSizeX < 128) {
    throw invalid('设备不支持所需的 128 线程工作组。');
  }
  const bodyGroups = Math.ceil(count / tileSize);
  const collisionGroups = Math.ceil(count / 128);
  // Two compacting candidate slots, at most 8 MiB in total. Capacity is a
  // memory budget, never a limit on which collisions the solver considers.
  const storageLimit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
  const candidateCapacity = collisionless ? 0 : Math.min(262144, Math.ceil(Math.max(4096, count * 16) / 128) * 128,
    Math.floor(storageLimit / (32 * 128)) * 128);
  if (!collisionless && candidateCapacity < 128) throw invalid('设备碰撞候选缓冲容量不足。');
  const candidateGroups = Math.max(collisionGroups, Math.ceil(candidateCapacity / 128));
  const stateBytes = count * 2 * 16;
  if (stateBytes > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)) {
    throw invalid('设备粒子缓冲容量不足。');
  }

  const buffers = new Set();
  let disposed = false;
  let disposal = null;
  let parameterCursor = 0;
  const make = (label, size, usage) => {
    const buffer = device.createBuffer({ label, size, usage });
    buffers.add(buffer);
    return buffer;
  };
  function dispose() {
    if (disposed) return disposal;
    disposed = true;
    disposal = device.queue.onSubmittedWorkDone().catch(() => {}).then(() => {
      for (const buffer of buffers) buffer.destroy();
      buffers.clear();
    });
    return disposal;
  }

  try {
    const storageUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const positionHi = make('Gravity position high / two slots', stateBytes, storageUsage);
    const positionLo = make('Gravity position low / two slots', stateBytes, storageUsage);
    const velocity = make('Gravity velocity / two slots', stateBytes, storageUsage);
    const acceleration = make('Gravity acceleration / two slots', stateBytes, storageUsage);
    const control = make('Gravity committed metadata', CONTROL_BYTES, storageUsage);
    const parameterStride = Math.max(64, device.limits.minUniformBufferOffsetAlignment);
    // Slots 0–3: advance; 4: full capture; 5: light capture; 6: initialization.
    const parameters = make('Gravity immutable batch parameters', parameterStride * 7, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const stateLayout = device.createBindGroupLayout({ label: 'Gravity state layout', entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 64 } },
      ...[1, 2, 3, 4, 5].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } })),
    ] });
    const stateGroup = device.createBindGroup({ label: 'Gravity state', layout: stateLayout, entries: [
      { binding: 0, resource: { buffer: parameters, size: 64 } },
      ...[positionHi, positionLo, velocity, acceleration, control].map((buffer, i) => ({ binding: i + 1, resource: { buffer } })),
    ] });
    const captureLayout = device.createBindGroupLayout({ label: 'Gravity capture output layout', entries: [
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ] });
    let collisionLayout = null;
    let collisionGroup = null;
    if (!collisionless) {
      collisionLayout = device.createBindGroupLayout({ label: 'CCD bounded minima layout', entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ] });
      const minima = make('CCD candidate block minima', candidateGroups * 16, GPUBufferUsage.STORAGE);
      const candidates = make('CCD bounded compacting candidates', candidateCapacity * 32, GPUBufferUsage.STORAGE);
      collisionGroup = device.createBindGroup({ layout: collisionLayout, entries: [
        { binding: 0, resource: { buffer: minima } }, { binding: 2, resource: { buffer: candidates } },
      ] });
    }
    const plainPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [stateLayout] });
    const capturePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [stateLayout, captureLayout] });
    const collisionPipelineLayout = collisionLayout ? device.createPipelineLayout({ bindGroupLayouts: [stateLayout, collisionLayout] }) : null;
    const shader = device.createShaderModule({ label: collisionless ? 'Fixed-step collisionless KDK' : 'Fixed-step continuous sphere CCD',
      code: createPhysicsShader({ collisionless, tileSize }) });
    const compilation = await shader.getCompilationInfo();
    const errors = compilation.messages.filter(message => message.type === 'error');
    if (errors.length) throw invalid(errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n'));
    const entries = [...new Set(['initial_force', 'validate_initial', 'capture_state', ...(collisionless ? FREE_ENTRIES : CCD_ENTRIES)])];
    const results = await Promise.all(entries.map(async entryPoint => {
      const layout = entryPoint === 'capture_state' ? capturePipelineLayout
        : CANDIDATE_ENTRIES.has(entryPoint) ? collisionPipelineLayout : plainPipelineLayout;
      const pipeline = await device.createComputePipelineAsync({ label: entryPoint, layout, compute: { module: shader, entryPoint } });
      return [entryPoint, pipeline];
    }));
    const pipelines = Object.fromEntries(results);

    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count * 3; i++) {
      const value = initial.positions[i];
      if (!Number.isFinite(value) || !Number.isFinite(initial.velocities[i])) throw invalid('初态含非有限数。');
      minimum[i % 3] = Math.min(minimum[i % 3], value);
      maximum[i % 3] = Math.max(maximum[i % 3], value);
    }
    const origin = minimum.map((value, k) => value * 0.5 + maximum[k] * 0.5);
    const hi = new Float32Array(count * 4);
    const lo = new Float32Array(count * 4);
    const velocities = new Float32Array(count * 4);
    const uploadedPositions = new Float64Array(count * 3);
    const uploadedVelocities = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
      const relative = initial.positions[i * 3 + k] - origin[k];
      hi[i * 4 + k] = relative;
      lo[i * 4 + k] = relative - hi[i * 4 + k];
      velocities[i * 4 + k] = initial.velocities[i * 3 + k];
      if (!Number.isFinite(hi[i * 4 + k]) || !Number.isFinite(lo[i * 4 + k]) || !Number.isFinite(velocities[i * 4 + k])) {
        throw invalid('初态超出 GPU f32 范围。');
      }
      uploadedPositions[i * 3 + k] = origin[k] + (hi[i * 4 + k] + lo[i * 4 + k]);
      uploadedVelocities[i * 3 + k] = velocities[i * 4 + k];
    }
    device.queue.writeBuffer(positionHi, 0, hi);
    device.queue.writeBuffer(positionLo, 0, lo);
    device.queue.writeBuffer(velocity, 0, velocities);
    const initialControl = new ArrayBuffer(CONTROL_BYTES);
    const cu = new Uint32Array(initialControl);
    const cf = new Float32Array(initialControl);
    cu[0] = 0; cu[1] = startStep; cu[2] = startCollisions;
    cf[8] = startTime; cf[9] = startTime - cf[8];
    cf[10] = initialLoss / mass; cf[11] = initialLoss / mass - cf[10];
    if (![cf[8], cf[9], cf[10], cf[11]].every(Number.isFinite)) throw invalid('初始时间或耗散超出 GPU 范围。');
    device.queue.writeBuffer(control, 0, initialControl);

    function writeParameters(slot, targetStep, fullCapture = false) {
      const data = new ArrayBuffer(64);
      const u = new Uint32Array(data); const f = new Float32Array(data);
      u[0] = count; u[1] = targetStep; u[2] = maxEvents; u[3] = candidateGroups;
      f[4] = gravity * mass; f[5] = STEP; f[6] = softening * softening; f[7] = radius * 2;
      f[8] = restitution; f[9] = mass; u[10] = sampleCount; u[11] = fullCapture ? 1 : 0;
      u[12] = candidateCapacity;
      for (let i = 4; i <= 9; i++) if (!Number.isFinite(f[i])) throw invalid('物理参数超出 GPU 范围。');
      if ((gravity > 0 && f[4] === 0) || (collisionless && f[6] === 0)) throw invalid('物理参数低于 GPU 数值分辨率。');
      device.queue.writeBuffer(parameters, slot * parameterStride, data);
      return slot * parameterStride;
    }
    function dispatch(pass, entry, offset, groups = 1, extraGroup = null) {
      pass.setPipeline(pipelines[entry]);
      pass.setBindGroup(0, stateGroup, [offset]);
      if (extraGroup) pass.setBindGroup(1, extraGroup);
      pass.dispatchWorkgroups(groups);
    }

    function encodeAdvance(encoder, { targetStep, slots = 1, timestampWrites } = {}) {
      if (disposed) throw invalid('引擎已释放。');
      if (!Number.isInteger(targetStep) || targetStep < startStep || targetStep > 0xfffffffe) throw invalid('目标物理步计数无效。');
      slots = Math.max(1, Math.min(64, Math.floor(slots) || 1));
      const offset = writeParameters(parameterCursor, targetStep);
      parameterCursor = (parameterCursor + 1) % ADVANCE_PARAMETER_SLOTS;
      const pass = encoder.beginComputePass({ label: collisionless ? 'Fixed KDK steps' : 'Resumable fixed-step CCD',
        ...(timestampWrites ? { timestampWrites } : {}) });
      for (let i = 0; i < slots; i++) {
        if (collisionless) {
          dispatch(pass, 'kick_drift', offset, bodyGroups);
        } else {
          dispatch(pass, 'ccd_begin', offset, collisionGroups);
          dispatch(pass, 'ccd_start', offset);
          dispatch(pass, 'ccd_build_candidates', offset, collisionGroups, collisionGroup);
          dispatch(pass, 'ccd_finish_build', offset);
          dispatch(pass, 'ccd_scan_min', offset, candidateGroups, collisionGroup);
          dispatch(pass, 'ccd_minimum', offset, 1, collisionGroup);
          dispatch(pass, 'ccd_scan_ties', offset, candidateGroups, collisionGroup);
          dispatch(pass, 'ccd_select', offset, 1, collisionGroup);
          dispatch(pass, 'ccd_drift', offset, collisionGroups);
          dispatch(pass, 'ccd_impact', offset);
          dispatch(pass, 'ccd_prepare_update', offset);
          dispatch(pass, 'ccd_retain', offset, candidateGroups, collisionGroup);
          dispatch(pass, 'ccd_participants', offset, Math.ceil(2 * count / 128), collisionGroup);
          dispatch(pass, 'ccd_finish_update', offset);
        }
        dispatch(pass, 'force_final_kick', offset, bodyGroups);
        dispatch(pass, 'commit', offset);
      }
      pass.end();
      return { targetStep, slots };
    }

    function createCaptureSlot(full, parameterSlot) {
      const size = CAPTURE_HEADER_BYTES + (full ? count * 48 + sampleCount * 16 : 0);
      const packed = make(full ? 'Full committed capture' : 'Light committed capture', size, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
      const staging = make(full ? 'Full capture staging' : 'Light capture staging', size, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
      const group = device.createBindGroup({ layout: captureLayout, entries: [{ binding: 1, resource: { buffer: packed } }] });
      return { full, parameterSlot, size, packed, staging, group, busy: false };
    }
    const captureSlots = [createCaptureSlot(false, 5), createCaptureSlot(true, 4)];

    function decodeCapture(buffer, full) {
      const u = new Uint32Array(buffer); const f = new Float32Array(buffer);
      if (u[0] > 1 || u[3] > 1 || u[1] < startStep) throw invalid('快照元数据无效。');
      const min = [f[28], f[29], f[30]].map((value, k) => value + origin[k]);
      const max = [f[32], f[33], f[34]].map((value, k) => value + origin[k]);
      const center = min.map((value, k) => value * 0.5 + max[k] * 0.5);
      const bounds = { min, max, center, radius: Math.hypot(...max.map((value, k) => (value - min[k]) * 0.5)) + radius, maxSpeed: f[31] };
      const metadata = {
        acceptedSteps: u[1], committedStep: u[1], time: startTime + (u[1] - startStep) * STEP,
        collisions: u[2], collisionEnergyLoss: (f[10] + f[11]) * mass, status: u[3] ? 'stopped' : 'running',
        detail: faultDescription(u[19] || u[4]), fault: u[19] || u[4], bounds,
        activeIndex: u[0], pendingStep: !collisionless && u[5] !== 0 && u[3] === 0,
        collisionCandidates: collisionless ? 0 : Math.min(u[20], candidateCapacity), collisionStreaming: !collisionless && u[23] === 2,
        count, radius, mass, origin: [...origin], forcePrecision: 'f32',
      };
      if (![...min, ...max, bounds.radius, bounds.maxSpeed, metadata.time, metadata.collisionEnergyLoss].every(Number.isFinite)
        || metadata.collisionEnergyLoss < 0) throw invalid('快照含非有限数。');
      if (!full) return metadata;
      const positions = new Float64Array(count * 3);
      const capturedVelocities = new Float64Array(count * 3);
      for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
        const start = CAPTURE_HEADER_BYTES / 4 + i * 12;
        positions[i * 3 + k] = origin[k] + (f[start + k] + f[start + 4 + k]);
        capturedVelocities[i * 3 + k] = f[start + 8 + k];
        if (!Number.isFinite(positions[i * 3 + k]) || !Number.isFinite(capturedVelocities[i * 3 + k])) throw invalid('完整快照含非有限数。');
      }
      const sampleIndices = new Uint32Array(sampleCount);
      const sampleAccelerations = new Float64Array(sampleCount * 3);
      const sampleOffset = CAPTURE_HEADER_BYTES / 4 + count * 12;
      for (let i = 0; i < sampleCount; i++) {
        sampleIndices[i] = Math.floor(i * count / sampleCount);
        for (let k = 0; k < 3; k++) {
          const value = f[sampleOffset + i * 4 + k];
          if (!Number.isFinite(value)) throw invalid('求力参考快照含非有限数。');
          sampleAccelerations[i * 3 + k] = value;
        }
      }
      return { ...metadata, positions, velocities: capturedVelocities, sampleIndices, sampleAccelerations };
    }

    function encodeCapture(encoder, { full = false } = {}) {
      if (disposed) return null;
      const slot = captureSlots[full ? 1 : 0];
      if (slot.busy) return null;
      slot.busy = true;
      try {
        const offset = writeParameters(slot.parameterSlot, 0, full);
        // Copy metadata before packing bodies; no compute can intervene within
        // this encoder. A partial CCD trial never changes the active slot.
        encoder.copyBufferToBuffer(control, 0, slot.packed, 0, CONTROL_BYTES);
        const pass = encoder.beginComputePass({ label: 'Committed state capture' });
        dispatch(pass, 'capture_state', offset, 1, slot.group);
        pass.end();
        encoder.copyBufferToBuffer(slot.packed, 0, slot.staging, 0, slot.size);
      } catch (error) { slot.busy = false; throw error; }
      let promise = null;
      const read = () => {
        if (!promise) promise = (async () => {
          try {
            await slot.staging.mapAsync(GPUMapMode.READ);
            if (disposed) throw invalid('读取期间引擎已释放。');
            return decodeCapture(slot.staging.getMappedRange(), full);
          } finally {
            slot.staging.unmap();
            slot.busy = false;
          }
        })();
        return promise;
      };
      return { read, full, byteLength: slot.size };
    }

    const offset = writeParameters(6, startStep);
    const encoder = device.createCommandEncoder({ label: 'Prime committed GPU acceleration' });
    const pass = encoder.beginComputePass();
    dispatch(pass, 'initial_force', offset, bodyGroups);
    dispatch(pass, 'validate_initial', offset);
    pass.end();
    const firstCapture = encodeCapture(encoder);
    device.queue.submit([encoder.finish()]);
    const firstMetadata = await firstCapture.read();
    if (firstMetadata.status === 'stopped') throw invalid(firstMetadata.detail);

    return {
      backend: 'webgpu', precision: 'f32', collisionless, count, radius, mass, step: STEP, tileSize,
      source: { kind: 'gpu', positionHi, positionLo, control, count, radius, origin },
      initialState: { ...initial, ...firstMetadata, positions: uploadedPositions, velocities: uploadedVelocities },
      compilationWarnings: compilation.messages.filter(message => message.type === 'warning').map(message => message.message),
      encodeAdvance, encodeCapture, dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

import { INTEGRATOR_SHADER } from './webgpu-integrator.wgsl.js';

const BODY_BYTES = 128;
const BODY_FLOATS = BODY_BYTES / 4;
const CONTROL_BYTES = 96;
const WAIT_MS = 5000;
const ENTRIES = ['request', 'prepare', 'begin_trial', 'restore_committed', 'initial_pairs', 'select_hit',
  'drift', 'impact', 'participant_pairs', 'reduce_pairs', 'forces', 'final_kick', 'validate_commit', 'publish', 'commit'];
const SCHEDULERS = new Set(['request', 'prepare', 'select_hit', 'impact', 'commit']);
const FAULTS = {
  1: 'GPU 物理步长低于数值分辨率，已安全暂停。',
  2: 'GPU 密集接触细分达到预算，已回滚未提交物理步并暂停。',
  3: '状态超出 GPU f32 数值或空间分辨率，已回滚未提交物理步并暂停。',
};
const clock = () => globalThis.performance?.now() ?? Date.now();
function gpuError(message, cause) {
  const error = new Error(message); error.name = 'WebGPUPhysicsError';
  if (cause) error.cause = cause;
  return error;
}
function bounded(promise, label, late) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(gpuError(`${label} timed out.`)); }, WAIT_MS);
    Promise.resolve(promise).then(value => {
      if (settled) { late?.(value); return; }
      settled = true; clearTimeout(timer); resolve(value);
    }, error => {
      if (settled) return;
      settled = true; clearTimeout(timer); reject(gpuError(`${label}: ${error?.message || error}`, error));
    });
  });
}

/**
 * Resident f32 KDK + sequential event-driven CCD. CPU reads only batch control
 * records and explicit committed snapshots; no per-force or per-event mapping.
 * All methods must be awaited serially. configure starts at a snapshot boundary.
 */
export async function createWebGPUSimulation({ stepsPerBatch = 16, eventsPerSlot = 2 } = {}) {
  stepsPerBatch = Math.max(1, Math.min(64, Math.floor(stepsPerBatch) || 16));
  eventsPerSlot = Math.max(1, Math.min(16, Math.floor(eventsPerSlot) || 2));
  const gpu = globalThis.navigator?.gpu, usage = globalThis.GPUBufferUsage;
  if (!gpu || !usage || !globalThis.GPUMapMode) throw gpuError('WebGPU is unavailable.');
  const adapter = await bounded(gpu.requestAdapter({ powerPreference: 'high-performance' }), 'GPU adapter');
  if (!adapter || adapter.isFallbackAdapter) throw gpuError('No hardware WebGPU adapter is available.');
  const device = await bounded(adapter.requestDevice({ label: 'Resident gravity and CCD' }), 'GPU device', value => value.destroy());
  let disposed = false, failure = null, busy = false;
  let simulation = null, resources = null, checkpoint = null;
  let origin = [0, 0, 0];
  const waiters = new Set();
  const pipelines = {};
  const metrics = { batches: 0, slots: 0, scalarReadbacks: 0, snapshots: 0 };
  const fail = error => {
    failure ||= error;
    for (const reject of waiters) reject(failure);
    waiters.clear();
  };
  const uncaptured = event => {
    event.preventDefault(); fail(gpuError(`GPU physics error: ${event.error.message}`, event.error));
  };
  device.addEventListener('uncapturederror', uncaptured);
  device.lost.then(info => {
    if (!disposed) fail(gpuError(`GPU device lost (${info.reason}): ${info.message}`));
  }, error => fail(gpuError('GPU device state could not be observed.', error)));

  function usable() {
    if (disposed || failure) throw failure || gpuError('GPU physics has been disposed.');
  }
  function waitGPU(promise, label) {
    const operation = Promise.resolve(promise);
    if (failure || disposed) { operation.catch(() => {}); return Promise.reject(failure || gpuError('GPU physics disposed.')); }
    return new Promise((resolve, reject) => {
      let done = false, timer;
      const finish = (error, value) => {
        if (done) return;
        done = true; clearTimeout(timer); waiters.delete(onFailure);
        if (error) reject(error); else resolve(value);
      };
      const onFailure = error => finish(error);
      waiters.add(onFailure);
      timer = setTimeout(() => fail(gpuError(`${label} timed out.`)), WAIT_MS);
      operation.then(value => finish(null, value), error => finish(gpuError(`${label}: ${error?.message || error}`, error)));
    });
  }
  async function checked(label, operation) {
    usable();
    let result, problem;
    for (const kind of ['validation', 'out-of-memory', 'internal']) device.pushErrorScope(kind);
    try { result = await waitGPU(operation(), label); }
    catch (error) { problem = error; }
    const errors = await waitGPU(Promise.all([device.popErrorScope(), device.popErrorScope(), device.popErrorScope()]), `${label} validation`);
    usable();
    const validation = errors.find(Boolean);
    if (validation) throw gpuError(`${label}: ${validation.message}`, validation);
    if (problem) throw problem;
    return result;
  }
  function release() {
    if (!resources) return;
    for (const buffer of Object.values(resources)) if (typeof buffer?.destroy === 'function') buffer.destroy();
    resources = null;
  }
  function dispose() {
    if (disposed) return;
    disposed = true; fail(gpuError('GPU physics disposed.'));
    device.removeEventListener('uncapturederror', uncaptured);
    release(); device.destroy();
  }

  const bindingLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ...Array.from({ length: 4 }, (_, i) => ({ binding: i + 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } })),
    { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
  ] });
  const schedulingLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ] });
  const bodyLayout = device.createPipelineLayout({ bindGroupLayouts: [bindingLayout] });
  const controlLayout = device.createPipelineLayout({ bindGroupLayouts: [bindingLayout, schedulingLayout] });
  let compilationWarnings;
  try {
    await checked('Resident physics shader compilation', async () => {
      const module = device.createShaderModule({ label: 'Resident KDK and continuous hard-sphere CCD', code: INTEGRATOR_SHADER });
      const info = await waitGPU(module.getCompilationInfo(), 'Shader compilation information');
      const errors = info.messages.filter(message => message.type === 'error');
      if (errors.length) throw gpuError(errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n'));
      compilationWarnings = info.messages.filter(message => message.type === 'warning').map(message => message.message);
      const results = await Promise.all(ENTRIES.map(async entryPoint => [entryPoint, await device.createComputePipelineAsync({
        label: `Resident physics: ${entryPoint}`, layout: SCHEDULERS.has(entryPoint) ? controlLayout : bodyLayout,
        compute: { module, entryPoint },
      })]));
      for (const [name, pipeline] of results) pipelines[name] = pipeline;
    });
  } catch (error) { dispose(); throw error; }

  const parameterData = new ArrayBuffer(48), pu = new Uint32Array(parameterData), pf = new Float32Array(parameterData);
  function parameters(goal = 0) {
    const { config, count, radius, mass } = simulation;
    pu[0] = count; pu[1] = count * (count - 1) / 2; pu[2] = Math.ceil(pu[1] / 128); pu[3] = Math.max(128, count * 4);
    pf[4] = config.G * mass; pf[5] = radius * 2; pf[6] = config.restitution; pf[7] = config.maxDt;
    pf[8] = config.travelFraction * radius * 2;
    pf[9] = pf[4] ? Math.min(config.maxDt / 32, .00075 * Math.sqrt((2 * radius) ** 3 / (config.G * mass))) : 3.402823e38;
    pf[10] = goal;
    for (let i = 4; i <= 10; i++) if (!Number.isFinite(pf[i])) throw gpuError('GPU physics parameters exceed f32 range.');
    if (config.G * mass && !pf[4]) throw gpuError('GPU gravitational mass underflows f32.');
    device.queue.writeBuffer(resources.parameters, 0, parameterData);
  }
  function dispatch(pass, name, offset = null) {
    pass.setPipeline(pipelines[name]);
    pass.setBindGroup(0, resources.bindGroup);
    if (SCHEDULERS.has(name)) pass.setBindGroup(1, resources.schedulingBindGroup);
    if (offset === null) pass.dispatchWorkgroups(1);
    else pass.dispatchWorkgroupsIndirect(resources.indirect, offset * 4);
  }
  function slot(pass) {
    dispatch(pass, 'prepare');
    dispatch(pass, 'begin_trial', 0);
    dispatch(pass, 'initial_pairs', 3);
    for (let i = 0; i < eventsPerSlot; i++) {
      dispatch(pass, 'select_hit');
      dispatch(pass, 'drift', 6);
      dispatch(pass, 'impact');
      dispatch(pass, 'participant_pairs', 9);
      dispatch(pass, 'reduce_pairs', 12);
    }
    dispatch(pass, 'forces', 15);
    dispatch(pass, 'final_kick', 18);
    dispatch(pass, 'validate_commit');
    // Validation ends before publication; all bodies commit together.
    dispatch(pass, 'publish', 18);
    dispatch(pass, 'commit');
  }
  function metadata(data) {
    const u = new Uint32Array(data), f = new Float32Array(data);
    const result = { stage: u[0], fault: u[19], time: f[12] - f[13], progress: f[14] - f[15],
      collisions: u[16], acceptedSteps: u[17], retries: u[18], loss: f[20] - f[21],
      refinements: u[2], contactFailures: u[22], eventOverflows: u[23] };
    if (result.stage > 6 || result.fault > 3 || !Number.isFinite(result.time) || result.time < 0
      || !Number.isFinite(result.progress) || result.progress < 0 || !Number.isFinite(result.loss) || result.loss < 0) {
      throw gpuError('GPU physics returned invalid checkpoint metadata.');
    }
    return result;
  }
  function syncMetadata(meta) {
    simulation.time = meta.time; simulation.collisions = meta.collisions;
    simulation.acceptedSteps = meta.acceptedSteps; simulation.retries = meta.retries;
    simulation._collisionEnergyLoss = simulation.mass * meta.loss;
    simulation.forcePrecision = 'f32';
    metrics.refinements = meta.refinements; metrics.contactFailures = meta.contactFailures; metrics.eventOverflows = meta.eventOverflows;
    simulation.status = meta.stage === 5 ? 'stopped' : 'running';
    simulation.detail = FAULTS[meta.fault] || '';
    simulation.ccdStatus = meta.stage === 5 ? 'GPU 接触或数值求解暂停'
      : meta.stage === 2 ? 'GPU 连续碰撞 · 事件批次处理中' : 'GPU 连续碰撞检测';
  }
  function saveCheckpoint() {
    checkpoint = { time: simulation.time, collisions: simulation.collisions, acceptedSteps: simulation.acceptedSteps,
      retries: simulation.retries, _collisionEnergyLoss: simulation._collisionEnergyLoss,
      status: simulation.status, detail: simulation.detail, ccdStatus: simulation.ccdStatus };
  }
  function restoreCheckpoint() {
    // CPU body arrays are updated exclusively by a complete readSnapshot.
    if (simulation && checkpoint) Object.assign(simulation, checkpoint);
  }
  async function snapshotInternal() {
    usable();
    const size = simulation.count * BODY_BYTES;
    const readback = resources.snapshotReadback;
    const encoder = device.createCommandEncoder({ label: 'Committed physics checkpoint' });
    encoder.copyBufferToBuffer(resources.bodies, 0, readback, 0, size);
    encoder.copyBufferToBuffer(resources.control, 0, readback, size, CONTROL_BYTES);
    device.queue.submit([encoder.finish()]);
    try {
      await waitGPU(readback.mapAsync(GPUMapMode.READ), 'GPU physics snapshot');
      usable();
      const data = readback.getMappedRange();
      const state = new Float32Array(data, 0, size / 4);
      const meta = metadata(data.slice(size, size + CONTROL_BYTES));
      if (meta.stage === 5 && meta.contactFailures) {
        const cu = new Uint32Array(data, size, CONTROL_BYTES / 4);
        const cf = new Float32Array(data, size, CONTROL_BYTES / 4);
        const body = index => {
          const offset = index * BODY_FLOATS;
          return { position: [0, 1, 2].map(k => state[offset + k] - state[offset + 24 + k]),
            velocity: Array.from(state.slice(offset + 4, offset + 7)),
            committedPosition: [0, 1, 2].map(k => state[offset + 12 + k] - state[offset + 28 + k]),
            committedVelocity: Array.from(state.slice(offset + 16, offset + 19)) };
        };
        metrics.failedContact = { dt: cf[4], elapsed: cf[5], pair: [cu[9], cu[10]], bodies: [body(cu[9]), body(cu[10])] };
      }
      // Validate every committed field before changing the CPU checkpoint.
      for (let i = 0; i < simulation.count; i++) for (const field of [12, 13, 14, 16, 17, 18, 20, 21, 22, 28, 29, 30]) {
        if (!Number.isFinite(state[i * BODY_FLOATS + field])) throw gpuError('GPU checkpoint contains non-finite state.');
      }
      for (let i = 0; i < simulation.count; i++) for (let k = 0; k < 3; k++) {
        simulation.positions[i * 3 + k] = state[i * BODY_FLOATS + 12 + k] - state[i * BODY_FLOATS + 28 + k] + origin[k];
        simulation.velocities[i * 3 + k] = state[i * BODY_FLOATS + 16 + k];
        simulation.accelerations[i * 3 + k] = state[i * BODY_FLOATS + 20 + k];
      }
      syncMetadata(meta);
      simulation._diagnosticStamp = -Infinity;
      saveCheckpoint(); metrics.snapshots++;
      return simulation;
    } finally { readback.unmap(); }
  }
  async function exclusive(operation) {
    usable(); if (busy) throw gpuError('GPU physics operations must be awaited serially.');
    busy = true;
    try { return await operation(); }
    finally { busy = false; }
  }

  async function uploadInternal(target, prepareInitial) {
    simulation = target;
    const preparing = target._initialContactsPending;
    if (prepareInitial && preparing && !target._prepareInitialContacts()) throw gpuError(target.detail);
    // Configure changes baseline on the CPU first. Capture its metadata before
    // allocations so failure restoration cannot pair new config with old loss.
    saveCheckpoint();
    const count = target.count, bodySize = count * BODY_BYTES, pairs = count * (count - 1) / 2;
    if (!Number.isInteger(count) || count < 2 || count > 1000) throw gpuError('Resident physics supports 2–1000 spheres.');
    const required = Math.max(bodySize, pairs * 8);
    if (required > Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize)) throw gpuError('GPU storage limits are too small.');
    release();
    await checked('Resident physics buffer allocation', () => {
      resources = {};
      const make = (name, size, flags) => { resources[name] = device.createBuffer({ label: `Resident ${name}`, size, usage: flags }); };
      make('parameters', 48, usage.UNIFORM | usage.COPY_DST);
      make('bodies', bodySize, usage.STORAGE | usage.COPY_DST | usage.COPY_SRC);
      make('control', CONTROL_BYTES, usage.STORAGE | usage.COPY_DST | usage.COPY_SRC);
      make('times', Math.max(4, pairs * 4), usage.STORAGE);
      make('minima', Math.max(8, Math.ceil(pairs / 128) * 8), usage.STORAGE);
      make('pairIndices', Math.max(8, pairs * 8), usage.STORAGE | usage.COPY_DST);
      make('indirect', 84, usage.STORAGE | usage.INDIRECT);
      make('controlReadback', CONTROL_BYTES, usage.MAP_READ | usage.COPY_DST);
      make('snapshotReadback', bodySize + CONTROL_BYTES, usage.MAP_READ | usage.COPY_DST);
      resources.bindGroup = device.createBindGroup({ layout: bindingLayout, entries:
        ['parameters', 'bodies', 'control', 'times', 'minima', 'pairIndices'].map((name, binding) => ({ binding, resource: { buffer: resources[name] } })) });
      resources.schedulingBindGroup = device.createBindGroup({ layout: schedulingLayout,
        entries: [{ binding: 0, resource: { buffer: resources.indirect } }] });
    });
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < target.positions.length; i++) {
      if (!Number.isFinite(target.positions[i]) || !Number.isFinite(target.velocities[i])) throw gpuError('GPU state must be finite.');
      min[i % 3] = Math.min(min[i % 3], target.positions[i]); max[i % 3] = Math.max(max[i % 3], target.positions[i]);
    }
    origin = min.map((value, k) => value * .5 + max[k] * .5);
    const state = new Float32Array(count * BODY_FLOATS);
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
      const offset = i * BODY_FLOATS;
      const relative = target.positions[i * 3 + k] - origin[k];
      state[offset + k] = relative;
      state[offset + 4 + k] = target.velocities[i * 3 + k];
      state[offset + 12 + k] = state[offset + k]; state[offset + 16 + k] = state[offset + 4 + k];
      state[offset + 24 + k] = state[offset + k] - relative;
      state[offset + 28 + k] = state[offset + 24 + k];
      if (!Number.isFinite(state[offset + k]) || !Number.isFinite(state[offset + 4 + k])) throw gpuError('GPU state exceeds f32 range.');
    }
    const controlData = new ArrayBuffer(CONTROL_BYTES), u = new Uint32Array(controlData), f = new Float32Array(controlData);
    // Pair IDs never change between initial-condition applications; decode
    // once on upload instead of half a million shader square roots per trial.
    const indices = new Uint32Array(pairs * 2);
    let pair = 0;
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      indices[pair++] = i; indices[pair++] = j;
    }
    u[0] = 6; u[16] = target.collisions; u[17] = target.acceptedSteps; u[18] = target.retries;
    f[12] = target.time; f[13] = f[12] - target.time;
    const loss = target._collisionEnergyLoss / target.mass; f[20] = loss; f[21] = f[20] - loss;
    parameters();
    device.queue.writeBuffer(resources.bodies, 0, state);
    device.queue.writeBuffer(resources.control, 0, controlData);
    device.queue.writeBuffer(resources.pairIndices, 0, indices);
    const encoder = device.createCommandEncoder({ label: 'Initial resident acceleration' });
    const pass = encoder.beginComputePass();
    dispatch(pass, 'request'); dispatch(pass, 'forces', 15); dispatch(pass, 'final_kick', 18);
    dispatch(pass, 'publish', 18); dispatch(pass, 'commit'); pass.end();
    device.queue.submit([encoder.finish()]);
    await snapshotInternal();
    if (target.status === 'stopped') throw gpuError(target.detail);
    if (preparing) target._setBaseline();
    target._initialContactsPending = false; target._normaliseInitialMotion = false;
    target._lastForceEvaluator = null; target.status = 'ready';
    saveCheckpoint();
    return target;
  }

  async function advanceInternal(duration, budgetMs) {
    if (!simulation || !Number.isFinite(duration) || duration <= 0 || simulation.status === 'stopped') return 0;
    const started = clock(), before = simulation.time;
    parameters(duration);
    let first = true, progress = 0, progressPerSlot = simulation.config.maxDt;
    do {
      // Short playback targets need fewer slots. Once contact/refinement work
      // is observed, estimate its cost from committed progress; a batch making
      // no progress gets the full slot budget to finish its pending CCD trial.
      const batchSlots = progressPerSlot > 0
        ? Math.min(stepsPerBatch, Math.max(1, Math.ceil((duration - progress) / progressPerSlot)))
        : stepsPerBatch;
      const previousProgress = progress;
      const encoder = device.createCommandEncoder({ label: 'Resident physics batch' });
      const readback = resources.controlReadback;
      const pass = encoder.beginComputePass({ label: 'Ordered resident KDK and CCD stages' });
      if (first) dispatch(pass, 'request');
      for (let i = 0; i < batchSlots; i++) slot(pass);
      pass.end();
      encoder.copyBufferToBuffer(resources.control, 0, readback, 0, CONTROL_BYTES);
      device.queue.submit([encoder.finish()]);
      try {
        await waitGPU(readback.mapAsync(GPUMapMode.READ), 'GPU physics batch');
        usable();
        const meta = metadata(readback.getMappedRange());
        syncMetadata(meta); progress = meta.progress;
      } finally { readback.unmap(); }
      progressPerSlot = Math.max(0, progress - previousProgress) / batchSlots;
      first = false; metrics.batches++; metrics.scalarReadbacks++; metrics.slots += batchSlots;
      if (simulation.status === 'stopped') break;
    } while (progress < duration - Math.max(1e-8, duration * 2e-7) && clock() - started < budgetMs);
    const elapsed = clock() - started;
    simulation.stepMs = elapsed;
    return Math.max(0, simulation.time - before);
  }

  async function configureInternal(target) {
    if (target !== simulation || !resources || target.count !== pu[0]) return uploadInternal(target, false);
    saveCheckpoint();
    parameters();
    const data = new ArrayBuffer(CONTROL_BYTES), u = new Uint32Array(data), f = new Float32Array(data);
    u[0] = 6; u[16] = target.collisions; u[17] = target.acceptedSteps; u[18] = target.retries;
    f[12] = target.time; f[13] = f[12] - target.time;
    const loss = target._collisionEnergyLoss / target.mass; f[20] = loss; f[21] = f[20] - loss;
    device.queue.writeBuffer(resources.control, 0, data);
    const encoder = device.createCommandEncoder({ label: 'Resident parameter boundary' });
    const pass = encoder.beginComputePass();
    dispatch(pass, 'request'); dispatch(pass, 'restore_committed', 18);
    dispatch(pass, 'forces', 15); dispatch(pass, 'final_kick', 18);
    dispatch(pass, 'publish', 18); dispatch(pass, 'commit'); pass.end();
    device.queue.submit([encoder.finish()]);
    await snapshotInternal();
    if (target.status === 'stopped') throw gpuError(target.detail);
    target.status = 'ready'; saveCheckpoint();
    return target;
  }

  return { backend: 'webgpu', precision: 'f32', resident: true, compilationWarnings, metrics,
    upload: target => exclusive(() => uploadInternal(target, true)),
    configure: target => exclusive(() => configureInternal(target)),
    advance: (duration, budgetMs = 8) => exclusive(() => advanceInternal(duration, budgetMs)),
    readSnapshot: () => exclusive(snapshotInternal), restoreCheckpoint, dispose };
}

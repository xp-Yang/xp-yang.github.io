import { Simulation } from './physics/simulation.js';
import { createWebGPUSimulation } from './physics/webgpu-simulation.js';

const COMPUTE_BUDGET_MS = 8;
const SNAPSHOT_INTERVAL_MS = 1000 / 30;
const MAX_BACKLOG_SECONDS = .1;
let simulation = null;
let epoch = 0;
let lastDiagnosticsAt = -Infinity;
let diagnostics = null;
let running = false;
let speed = 1;
let clockAt = 0;
let debt = 0;
let lastSnapshotAt = 0;
let advancedSinceSnapshot = 0;
let batchMs = 0;
let generation = 0;
let timer = null;
let gpuSolver = null;
let gpuFailure = '';
let requestedBackend = 'webgpu';
let forceBackend = 'tree';
let forceBackendDetail = '';
let gpuPausePending = false;
let operations = Promise.resolve();

// Resident GPU operations can yield the event loop. Serialise snapshots,
// controls and compute batches so resets cannot replace an active GPU state.
function enqueue(operation, context = {}) {
  operations = operations.then(operation).catch(error => {
    running = false;
    cancelPump();
    self.postMessage({ type: 'error', epoch: context.epoch ?? epoch,
      request: context.request ?? null, message: error.message || String(error) });
  });
}

function cpuBackend() {
  return simulation.config.theta > 0 && simulation.count > 64 ? 'tree' : 'direct';
}

function disposeGPU() {
  gpuSolver?.dispose();
  gpuSolver = null;
}

function useCPUFallback(error, pause = false) {
  gpuFailure = error.message || String(error);
  if (pause) {
    // GPU advance updates scalar metadata before full state readback. Restore
    // matching metadata before exposing the last complete CPU checkpoint.
    gpuSolver?.restoreCheckpoint();
    gpuPausePending = true;
    running = false;
    cancelPump();
    advancedSinceSnapshot = 0;
  }
  disposeGPU();
  if (pause) { simulation.status = 'ready'; simulation.detail = ''; }
  if (!simulation._initialContactsPending) simulation._computeForces();
  forceBackend = cpuBackend();
  forceBackendDetail = pause
    ? `WebGPU 中断，已回到最近完整快照；未回读的 GPU 进度已丢弃。可点击播放使用 CPU 继续：${gpuFailure}`
    : `WebGPU 不可用，已使用 CPU：${gpuFailure}`;
  diagnostics = null;
  simulation._diagnosticStamp = -Infinity;
  if (pause) self.postMessage({ type: 'gpu-paused', epoch, message: forceBackendDetail });
}

async function readGPUState() {
  if (!gpuSolver) return true;
  try {
    await gpuSolver.readSnapshot();
    return true;
  } catch (error) {
    useCPUFallback(error, true);
    return false;
  }
}

async function selectBackend(config) {
  const previousBackend = requestedBackend;
  requestedBackend = ['webgpu', 'tree', 'direct'].includes(config.forceBackend) ? config.forceBackend : requestedBackend;
  if (requestedBackend === 'webgpu') {
    if (previousBackend !== 'webgpu') gpuFailure = '';
    const wasResident = Boolean(gpuSolver);
    try {
      if (!gpuSolver && !gpuFailure) {
        gpuSolver = await createWebGPUSimulation();
        await gpuSolver.upload(simulation);
      } else if (gpuSolver) {
        await gpuSolver.configure(simulation);
      }
    } catch (error) {
      // Device creation/upload has not advanced the model. A failure of an
      // existing resident solver instead requires an explicit checkpoint pause.
      useCPUFallback(error, wasResident);
    }
    forceBackend = gpuSolver ? 'webgpu' : cpuBackend();
    if (gpuSolver) forceBackendDetail = 'GPU 常驻积分与连续碰撞；画面快照约每秒读取 30 次。';
    else if (!forceBackendDetail) forceBackendDetail = `WebGPU 不可用，已使用 CPU：${gpuFailure}`;
  } else {
    disposeGPU();
    forceBackend = cpuBackend();
    forceBackendDetail = '';
  }
  if (!gpuSolver && !simulation._initialContactsPending) simulation._computeForces();
  diagnostics = null;
  simulation._diagnosticStamp = -Infinity;
}

async function advance(duration, budgetMs) {
  if (!gpuSolver) return simulation.advance(duration, budgetMs);
  try {
    // Only committed scalar metadata returns here; body arrays remain resident
    // until a frame or a control operation needs a complete checkpoint.
    return await gpuSolver.advance(duration, budgetMs);
  } catch (error) {
    useCPUFallback(error, true);
    return 0;
  }
}

// MessageChannel yields between compute batches without the nested timer clamp.
// Controls and resets run between these tasks rather than inside a GPU batch.
const pumpChannel = new MessageChannel();
pumpChannel.port1.onmessage = ({ data }) => enqueue(() => pump(data));

function cancelPump() {
  generation++;
  clearTimeout(timer);
  timer = null;
  clockAt = performance.now();
  debt = 0;
}

function schedulePump(delayMs = 0) {
  const token = generation;
  if (delayMs > 0) timer = setTimeout(() => {
    timer = null;
    if (token === generation) pumpChannel.port2.postMessage(token);
  }, delayMs);
  else pumpChannel.port2.postMessage(token);
}

async function snapshot(type, request = null, advanced = 0, computeMs = 0) {
  const synchronized = await readGPUState();
  if (!synchronized) advanced = 0;
  const now = performance.now();
  if (now - lastDiagnosticsAt > 850 || !diagnostics || type === 'ready'
    || (diagnostics.initialContactsPending && type === 'frame') || simulation.status === 'stopped') {
    // Exact CPU diagnostics run on the complete committed snapshot, not the
    // newer scalar-only metadata returned by a resident compute batch.
    diagnostics = simulation.stats();
    lastDiagnosticsAt = now;
  }
  const positions = new Float32Array(simulation.positions);
  self.postMessage({
    type, epoch, request, positions, advanced, computeMs,
    count: simulation.count,
    radius: simulation.radius,
    time: simulation.time,
    collisions: simulation.collisions,
    diagnostics,
    forceBackend, forceBackendDetail,
    status: simulation.status ?? diagnostics.status ?? 'running',
  }, [positions.buffer]);
  return synchronized;
}

async function flushFrame(request = null) {
  const synchronized = await snapshot('frame', request, advancedSinceSnapshot, batchMs);
  advancedSinceSnapshot = 0;
  lastSnapshotAt = performance.now();
  return synchronized;
}

async function pump(token) {
  if (token !== generation || !running || !simulation) return;
  const now = performance.now();
  debt = Math.min(debt + Math.max(0, now - clockAt) * speed / 1000, speed * MAX_BACKLOG_SECONDS);
  clockAt = now;
  // Accumulate at least one normal step, avoiding tiny idle-end fragments.
  const quantum = simulation.config.maxDt;
  if (debt >= quantum) {
    const started = performance.now();
    const duration = Math.floor(debt / quantum) * quantum;
    const advanced = await advance(duration, COMPUTE_BUDGET_MS);
    batchMs = performance.now() - started;
    debt = Math.max(0, debt - advanced);
    advancedSinceSnapshot += advanced;
  }
  if (performance.now() - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS || simulation.status === 'stopped' || !running) {
    await flushFrame();
  }
  if (!running) return;
  if (simulation.status === 'stopped') { running = false; cancelPump(); return; }
  const delay = debt >= quantum ? 0 : Math.min(16, Math.max(1, (quantum - debt) * 1000 / speed));
  schedulePump(delay);
}

self.onmessage = ({ data }) => enqueue(async () => {
  if (data.type === 'reset') {
    running = false;
    cancelPump();
    disposeGPU();
    gpuFailure = '';
    gpuPausePending = false;
    forceBackendDetail = '';
    epoch = data.epoch;
    simulation = new Simulation(data.config);
    diagnostics = null;
    lastDiagnosticsAt = -Infinity;
    advancedSinceSnapshot = 0;
    batchMs = 0;
    await selectBackend(data.config);
    await snapshot('ready', data.request);
    lastSnapshotAt = performance.now();
  } else if (simulation && data.epoch === epoch) {
    if (data.type === 'playback') {
      const wasRunning = running;
      // Publish outstanding progress before changing the clock or speed.
      const synchronized = !wasRunning || await flushFrame();
      cancelPump();
      speed = Math.max(.1, Math.min(20, Number(data.speed) || 1));
      // A readback failure must not resume from a stale pre-failure play command.
      // The UI acknowledges gpu-paused with running:false before a deliberate
      // user resume. Older queued running:true messages cannot clear the latch.
      const acknowledgedPause = !gpuPausePending;
      if (!data.running) gpuPausePending = false;
      running = synchronized && acknowledgedPause && Boolean(data.running) && simulation.status !== 'stopped';
      self.postMessage({ type: 'playback', epoch });
      if (running) schedulePump();
    } else if (data.type === 'configure') {
      // CPU configuration/baselines must see positions matching the committed
      // clock, and CPU switches must start from the last successful readback.
      await readGPUState();
      simulation.configure(data.config);
      await selectBackend(data.config);
      await snapshot('configured', data.request);
    } else if (data.type === 'advance' && !running) {
      const start = performance.now();
      const advanced = await advance(data.duration, data.budgetMs ?? 100);
      await snapshot('frame', data.request, advanced, performance.now() - start);
    }
  }
}, data);

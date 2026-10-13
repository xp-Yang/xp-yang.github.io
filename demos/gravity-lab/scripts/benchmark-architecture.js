import { createGpuEngine } from '../src/gpu/engine.js';
import { createGpuRenderer } from '../src/render/webgpu.js';
import { createInitialState, stateBounds } from '../src/physics/simulation.js';
import { FIXED_TIMESTEP } from '../src/physics/timestep.js';
import { PARTICLE_RADIUS, PARTICLE_MASS } from '../src/physics/constants.js';

const COUNTS = [1_000, 5_000, 20_000];
const BATCH_STEPS = 8;
const WARMUP_STEPS = 24;
const CONFIG = Object.freeze({ distribution: 'shell', seed: 42, packing: .025,
  virial: 0, G: 1, collisionless: true, softeningRatio: 1, restitution: 1 });
const elements = Object.fromEntries(['scene', 'steps', 'runs', 'start', 'stop', 'download', 'status', 'results']
  .map(id => [id, document.getElementById(id)]));
let report = null;
let stopRequested = false;
let running = false;

function display(message) {
  elements.status.textContent = message;
  if (report) elements.results.textContent = JSON.stringify(report, null, 2);
}

/** Preserve every pass timestamp until the measurement ends: no in-loop map. */
function createPassTiming(device, batchCount) {
  if (!device.features.has('timestamp-query')) return null;
  const count = batchCount * 4;
  const queries = device.createQuerySet({ type: 'timestamp', count });
  const resolved = device.createBuffer({ size: count * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: count * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  return {
    batch(index) {
      return {
        physics: { querySet: queries, beginningOfPassWriteIndex: index * 4, endOfPassWriteIndex: index * 4 + 1 },
        render: { querySet: queries, beginningOfPassWriteIndex: index * 4 + 2, endOfPassWriteIndex: index * 4 + 3 },
      };
    },
    resolve(encoder, batches) {
      if (!batches) return;
      encoder.resolveQuerySet(queries, 0, batches * 4, resolved, 0);
      encoder.copyBufferToBuffer(resolved, 0, readback, 0, batches * 32);
    },
    async read(batches) {
      if (!batches) return { physicsMs: 0, renderMs: 0, batches: [] };
      try {
        await readback.mapAsync(GPUMapMode.READ);
        const values = new BigUint64Array(readback.getMappedRange());
        const times = [];
        for (let i = 0; i < batches; i++) {
          const physics = values[i * 4 + 1] - values[i * 4];
          const render = values[i * 4 + 3] - values[i * 4 + 2];
          if (physics < 0n || render < 0n) throw new Error('GPU 时间戳顺序无效。');
          times.push({ physicsMs: Number(physics) / 1e6, renderMs: Number(render) / 1e6 });
        }
        return { physicsMs: times.reduce((sum, t) => sum + t.physicsMs, 0),
          renderMs: times.reduce((sum, t) => sum + t.renderMs, 0), batches: times };
      } finally { readback.unmap(); }
    },
    dispose() { queries.destroy(); resolved.destroy(); readback.destroy(); },
  };
}

/** Wall time includes encoding, two-batch backpressure, GPU compute and drawing. */
async function measure(device, renderer, engine, steps, collectTimestamps) {
  const timing = collectTimestamps ? createPassTiming(device, Math.ceil(steps / BATCH_STEPS)) : null;
  const visibilityChanges = [];
  const onVisibility = () => visibilityChanges.push({ elapsedMs: performance.now() - startedAt, state: document.visibilityState });
  const visibilityAtStart = document.visibilityState;
  const pending = [];
  let batches = 0;
  let scheduledSteps = 0;
  let readbackMs = null;
  let gpu = null;
  let timingError = null;
  const startedAt = performance.now();
  document.addEventListener('visibilitychange', onVisibility);
  try {
    while (scheduledSteps < steps && !stopRequested) {
      const slots = Math.min(BATCH_STEPS, steps - scheduledSteps);
      scheduledSteps += slots;
      const encoder = device.createCommandEncoder({ label: 'Manual architecture throughput batch' });
      const timestamps = timing?.batch(batches);
      engine.encodeAdvance(encoder, { targetStep: scheduledSteps, slots, timestampWrites: timestamps?.physics });
      const now = performance.now();
      renderer.update(now);
      renderer.encode(encoder, now, timestamps?.render);
      device.queue.submit([encoder.finish()]);
      batches++;
      pending.push(device.queue.onSubmittedWorkDone());
      if (pending.length >= 2) await pending.shift();
    }
    await Promise.all(pending);
    const wallMs = performance.now() - startedAt;
    const visibilityAtEnd = document.visibilityState;
    // This is the first readback after the timed queue has finished. It also
    // reports a stopped/partial scenario instead of assuming submitted = done.
    const readbackStartedAt = performance.now();
    const encoder = device.createCommandEncoder({ label: 'Untimed benchmark metadata and timestamp capture' });
    const capture = engine.encodeCapture(encoder, { full: false });
    if (!capture) throw new Error('最终元数据捕获不可用。');
    timing?.resolve(encoder, batches);
    device.queue.submit([encoder.finish()]);
    const [metadata, timestamps] = await Promise.all([
      capture.read(),
      timing?.read(batches).catch(error => { timingError = error.message; return null; }),
    ]);
    gpu = timestamps ?? null;
    readbackMs = performance.now() - readbackStartedAt;
    const simulatedSeconds = metadata.acceptedSteps * FIXED_TIMESTEP;
    return {
      requestedSteps: steps, scheduledSteps, acceptedSteps: metadata.acceptedSteps,
      fixedStepSeconds: FIXED_TIMESTEP, simulatedSeconds, wallMs,
      advanceMultiplier: wallMs > 0 ? simulatedSeconds * 1000 / wallMs : null,
      status: metadata.status,
      outcome: metadata.status === 'stopped' ? 'stopped'
        : metadata.acceptedSteps === steps ? 'completed' : stopRequested ? 'interrupted' : 'incomplete',
      detail: metadata.detail, fault: metadata.fault, collisions: metadata.collisions,
      collisionEnergyLoss: metadata.collisionEnergyLoss,
      submittedBatches: batches, drawCalls: batches, tileSize: engine.tileSize,
      finalCaptureMs: readbackMs, gpu, timingError,
      visibilityAtStart, visibilityAtEnd, visibilityChanges,
    };
  } finally {
    document.removeEventListener('visibilitychange', onVisibility);
    await device.queue.onSubmittedWorkDone().catch(() => {});
    timing?.dispose();
  }
}

async function runFreshEngine(device, renderer, initial, config, steps, timestamps) {
  let engine;
  const initializeAt = performance.now();
  try {
    engine = await createGpuEngine(device, initial, config);
    renderer.setSource(engine.source);
    renderer.setBounds(initial.bounds, initial.radius);
    renderer.fit();
    renderer.update(performance.now());
    const encoder = device.createCommandEncoder({ label: 'Untimed initial benchmark draw' });
    renderer.encode(encoder, performance.now());
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const initializationMs = performance.now() - initializeAt;
    const result = await measure(device, renderer, engine, steps, timestamps);
    return { ...result, initializationMs, compilationWarnings: engine.compilationWarnings,
      canvas: { width: renderer.view.width, height: renderer.view.height, pixelRatio: renderer.view.pixelRatio } };
  } finally { if (engine) await engine.dispose(); }
}

async function start() {
  if (running) return;
  running = true;
  stopRequested = false;
  elements.start.disabled = elements.steps.disabled = elements.runs.disabled = true;
  elements.stop.disabled = false;
  elements.download.disabled = true;
  const steps = Number(elements.steps.value);
  const runs = Number(elements.runs.value);
  report = {
    tool: 'gravity-lab-architecture-throughput', version: 1, startedAt: new Date().toISOString(), running: true,
    measurement: 'wall time: JS encoding + queue backpressure + GPU compute + direct rendering; initialization and final capture excluded',
    numericalValidation: 'not performed',
    parameters: { ...CONFIG, counts: COUNTS, radius: PARTICLE_RADIUS, mass: PARTICLE_MASS, steps, runs,
      warmupSteps: WARMUP_STEPS, stepsPerDraw: BATCH_STEPS, maxInFlight: 2,
      fixedStepSeconds: FIXED_TIMESTEP, trails: false, quality: 'low', canvasCssPixels: [960, 540] },
    environment: { userAgent: navigator.userAgent, language: navigator.language,
      hardwareConcurrency: navigator.hardwareConcurrency, devicePixelRatio: globalThis.devicePixelRatio },
    scenarios: [], errors: [],
  };
  let device;
  let renderer;
  const errors = report.errors;
  try {
    display('正在创建共享 GPU 设备与渲染器…');
    if (!navigator.gpu) throw new Error('当前环境没有 WebGPU。');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('没有可用的 GPU adapter。');
    const info = adapter.info;
    report.environment.adapter = info ? { vendor: info.vendor, architecture: info.architecture,
      device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter } : null;
    const requiredFeatures = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
    device = await adapter.requestDevice({ requiredFeatures });
    report.environment.timestampQuery = device.features.has('timestamp-query');
    report.environment.limits = { maxComputeInvocationsPerWorkgroup: device.limits.maxComputeInvocationsPerWorkgroup,
      maxComputeWorkgroupSizeX: device.limits.maxComputeWorkgroupSizeX,
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize };
    device.addEventListener('uncapturederror', event => errors.push({ type: 'gpu', message: event.error.message }));
    void device.lost.then(info => {
      if (info.reason !== 'destroyed') { errors.push({ type: 'device-lost', reason: info.reason, message: info.message }); stopRequested = true; }
    });
    renderer = await createGpuRenderer(elements.scene, device);
    renderer.setQuality('low');
    renderer.setTrails(false);
    renderer.view.controls.enabled = false;
    for (const count of COUNTS) {
      if (stopRequested) break;
      const config = { ...CONFIG, count };
      const scenario = { count, config, runs: [] };
      report.scenarios.push(scenario);
      display(`${count.toLocaleString()} 粒子：生成初态与暖机…`);
      await new Promise(requestAnimationFrame);
      try {
        const initialAt = performance.now();
        const initial = createInitialState(config);
        initial.bounds = stateBounds(initial.positions, count, initial.radius);
        scenario.initialStateMs = performance.now() - initialAt;
        scenario.warmup = await runFreshEngine(device, renderer, initial, config, WARMUP_STEPS, false);
        if (scenario.warmup.outcome !== 'completed') { display(`${count.toLocaleString()} 粒子暖机未完成。`); continue; }
        for (let run = 1; run <= runs && !stopRequested; run++) {
          display(`${count.toLocaleString()} 粒子：第 ${run}/${runs} 轮，${steps} 步…`);
          await new Promise(requestAnimationFrame);
          const errorOffset = errors.length;
          const result = await runFreshEngine(device, renderer, initial, config, steps, true);
          scenario.runs.push({ run, ...result, gpuErrors: errors.slice(errorOffset) });
          display(`${count.toLocaleString()} 粒子，第 ${run} 轮：${result.outcome}，${result.acceptedSteps} 步 / ${result.wallMs.toFixed(2)} ms。`);
          if (result.outcome !== 'completed') break;
        }
      } catch (error) { scenario.error = { name: error.name, message: error.message }; }
    }
  } catch (error) {
    errors.push({ type: 'tool', name: error.name, message: error.message });
  } finally {
    if (device) await device.queue.onSubmittedWorkDone().catch(() => {});
    renderer?.dispose();
    if (device) { await device.queue.onSubmittedWorkDone().catch(() => {}); device.destroy(); }
    report.running = false;
    report.stoppedByUserOrDevice = stopRequested;
    report.finishedAt = new Date().toISOString();
    running = false;
    elements.start.disabled = elements.steps.disabled = elements.runs.disabled = false;
    elements.stop.disabled = true;
    elements.download.disabled = false;
    display(stopRequested ? '计时已停止；已取得的数据保留在下方。' : '计时流程已结束；各场景完成状态与错误见原始 JSON。');
  }
}

elements.start.addEventListener('click', () => { void start(); });
elements.stop.addEventListener('click', () => { stopRequested = true; display('停止请求已收到，正在等待已提交的 GPU 批次完成…'); });
elements.download.addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `gravity-architecture-${report.startedAt.replaceAll(':', '-')}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

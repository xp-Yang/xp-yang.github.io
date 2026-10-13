// Performance timing only. This worker has no access to the product's state.
import { Simulation } from '../src/physics/simulation.js';
import { computeForces, createForceWorkspace } from '../src/physics/forces.js';
import { createWebGPUForceSolver } from '../src/physics/webgpu-forces.js';

const WARMUP_CALLS = 40;
const MEASURED_CALLS = 100;
const TARGET_SECONDS = 1;
const CHUNK_SECONDS = .1;
const WALL_LIMIT_MS = 15000;
const BASE_CONFIG = Object.freeze({
  count: 1000, radius: .25, density: 1, G: 1, virial: 0, rotation: 0,
  restitution: 1, seed: 42, maxDt: .016, travelFraction: .2,
});
const SCENARIOS = [
  { id: 'uniform', label: '均匀球云', distribution: 'uniform', packing: .025 },
  { id: 'shell-low', label: '均匀球壳 · 最低紧密度', distribution: 'shell', packing: .005 },
  { id: 'symmetric-shell', label: '对称球壳', distribution: 'symmetric-shell', packing: .025 },
];
const BACKENDS = [
  { id: 'tree', label: 'CPU Barnes–Hut (θ = 0.55)', theta: .55, precision: 'f64' },
  { id: 'direct', label: 'CPU direct sum (θ = 0)', theta: 0, precision: 'f64' },
  { id: 'webgpu', label: 'WebGPU direct sum (f32, upload + readback)', theta: 0, precision: 'f32' },
];
const clock = () => performance.now();
const messageOf = error => error.message || String(error);
let active = false;

function configFor(scenario, backend) {
  return { ...BASE_CONFIG, distribution: scenario.distribution, packing: scenario.packing, theta: backend.theta };
}

function diagnosticsFor(simulation) {
  try {
    const stats = simulation.stats(true);
    return {
      energyDrift: stats.energyDrift, momentumError: stats.momentumError,
      forceError: stats.forceError, kinetic: stats.kinetic,
      potential: stats.potential, ccdStatus: stats.ccdStatus,
    };
  } catch (error) { return { diagnosticError: messageOf(error) }; }
}

async function run(environment) {
  const startedAt = new Date().toISOString();
  const records = [];
  let gpu = null, gpuError = null;
  const record = value => { records.push(value); self.postMessage({ type: 'record', record: value }); };
  const progress = message => self.postMessage({ type: 'progress', message });
  const common = (scenario, backend) => ({
    scenario: scenario.id, scenarioLabel: scenario.label,
    backend: backend.id, backendLabel: backend.label,
    forcePrecision: backend.precision, integrationPrecision: 'f64',
    config: configFor(scenario, backend),
  });

  record({
    kind: 'environment', startedAt,
    environment: { ...environment, workerUserAgent: navigator.userAgent, workerWebgpuExposed: Boolean(navigator.gpu) },
    backends: BACKENDS, scenarios: SCENARIOS,
    warmupCalls: WARMUP_CALLS, measuredCalls: MEASURED_CALLS,
    targetSeconds: TARGET_SECONDS, chunkSeconds: CHUNK_SECONDS, wallLimitMs: WALL_LIMIT_MS,
  });
  progress('正在初始化 WebGPU 求力器…');
  const setupStarted = clock();
  try {
    gpu = await createWebGPUForceSolver();
    record({ kind: 'webgpu-setup', status: 'available', elapsedMs: clock() - setupStarted, tileSize: gpu.tileSize, compilationWarnings: gpu.compilationWarnings });
  } catch (error) {
    gpuError = messageOf(error);
    record({ kind: 'webgpu-setup', status: 'unavailable', elapsedMs: clock() - setupStarted, detail: gpuError });
  }

  try {
    // Every backend reads a freshly generated, identically seeded initial state.
    // GPU timing includes conversion, upload, dispatch, map/readback and publication.
    for (const scenario of SCENARIOS) for (const backend of BACKENDS) {
      progress(`求力计时：${scenario.label} / ${backend.label}`);
      if (backend.id === 'webgpu' && !gpu) {
        record({ kind: 'force', ...common(scenario, backend), status: 'unavailable', detail: gpuError });
        continue;
      }
      let forceStarted = null;
      try {
        const simulation = new Simulation(configFor(scenario, backend));
        const output = new Float64Array(simulation.positions.length);
        const workspace = createForceWorkspace(simulation.count);
        const gm = simulation.config.G * simulation.mass;
        if (backend.id === 'webgpu') {
          for (let i = 0; i < WARMUP_CALLS; i++) await gpu.compute(simulation.positions, simulation.count, gm, output);
          forceStarted = clock();
          for (let i = 0; i < MEASURED_CALLS; i++) await gpu.compute(simulation.positions, simulation.count, gm, output);
        } else {
          for (let i = 0; i < WARMUP_CALLS; i++) computeForces(simulation.positions, simulation.count, gm, backend.theta, output, workspace);
          forceStarted = clock();
          for (let i = 0; i < MEASURED_CALLS; i++) computeForces(simulation.positions, simulation.count, gm, backend.theta, output, workspace);
        }
        const elapsedMs = clock() - forceStarted;
        record({ kind: 'force', ...common(scenario, backend), status: 'completed', warmupCalls: WARMUP_CALLS, measuredCalls: MEASURED_CALLS, elapsedMs, meanMs: elapsedMs / MEASURED_CALLS });
      } catch (error) {
        record({ kind: 'force', ...common(scenario, backend), status: 'error', elapsedMs: forceStarted === null ? null : clock() - forceStarted, detail: messageOf(error) });
        if (backend.id === 'webgpu') { gpuError = messageOf(error); gpu.dispose(); gpu = null; }
      }
    }

    for (const scenario of SCENARIOS) for (const backend of BACKENDS) {
      progress(`积分计时：${scenario.label} / ${backend.label}`);
      if (backend.id === 'webgpu' && !gpu) {
        record({ kind: 'integration', ...common(scenario, backend), status: 'unavailable', detail: gpuError });
        continue;
      }
      let simulation = null, integrationStarted = null, failure = null;
      try {
        simulation = new Simulation(configFor(scenario, backend));
        const evaluateGPU = async target => {
          await gpu.compute(target.positions, target.count, target.config.G * target.mass, target.accelerations);
          target.forcePrecision = 'f32';
        };
        if (backend.id === 'webgpu' && typeof simulation.advanceAsync !== 'function') throw new Error('Simulation.advanceAsync is not available yet.');
        integrationStarted = clock();
        while (simulation.time < TARGET_SECONDS - 1e-12 && simulation.status !== 'stopped' && clock() - integrationStarted < WALL_LIMIT_MS) {
          const duration = Math.min(CHUNK_SECONDS, TARGET_SECONDS - simulation.time);
          if (backend.id === 'webgpu') await simulation.advanceAsync(duration, Infinity, evaluateGPU);
          else simulation.advance(duration, Infinity);
        }
      } catch (error) { failure = messageOf(error); }
      // Energy/momentum/force telemetry is computed after the timed integration.
      const elapsedMs = integrationStarted === null ? null : clock() - integrationStarted;
      const completed = simulation && simulation.time >= TARGET_SECONDS - 1e-12;
      const status = failure ? 'error' : completed ? 'completed' : simulation?.status === 'stopped' ? 'stopped' : 'wall-limit';
      record({
        kind: 'integration', ...common(scenario, backend), status,
        targetSeconds: TARGET_SECONDS, simulatedSeconds: simulation?.time ?? 0,
        elapsedMs, coreMultiplier: elapsedMs > 0 ? simulation.time * 1000 / elapsedMs : null,
        collisions: simulation?.collisions ?? null, acceptedSteps: simulation?.acceptedSteps ?? null,
        retries: simulation?.retries ?? null, simulationStatus: simulation?.status ?? null,
        detail: failure || simulation?.detail || null,
        diagnostics: simulation ? diagnosticsFor(simulation) : null,
      });
      if (failure && backend.id === 'webgpu') { gpuError = failure; gpu.dispose(); gpu = null; }
    }
  } finally { gpu?.dispose(); }

  const report = { kind: 'benchmark-webgpu-browser', schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(), environment, records };
  let saved = false, saveDetail = null;
  try {
    const response = await fetch('/__perf-result', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report),
      signal: AbortSignal.timeout(5000),
    });
    saved = response.ok;
    if (!saved) saveDetail = `HTTP ${response.status}`;
  } catch (error) { saveDetail = messageOf(error); }
  self.postMessage({ type: 'save', saved, detail: saveDetail });
  self.postMessage({ type: 'done', saved, recordCount: records.length });
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'run' || active) return;
  active = true;
  try { await run(data.environment ?? {}); }
  catch (error) {
    self.postMessage({ type: 'record', record: { kind: 'benchmark', status: 'error', detail: messageOf(error) } });
    self.postMessage({ type: 'error', message: messageOf(error) });
  }
  finally { active = false; }
};

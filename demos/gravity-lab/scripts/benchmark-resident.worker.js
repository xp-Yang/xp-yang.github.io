// Manual performance timing only; this worker never touches the product state.
import { Simulation } from '../src/physics/simulation.js';
import { sampleForceError } from '../src/physics/forces.js';
import { createWebGPUForceSolver } from '../src/physics/webgpu-forces.js';
import { createWebGPUSimulation } from '../src/physics/webgpu-simulation.js';

const TARGET_SECONDS = 1;
const WARMUP_SECONDS = .1;
const CHUNK_SECONDS = .1;
const TIME_TOLERANCE = 1e-6;
const WALL_LIMIT_MS = 30000;
const FORCE_SAMPLES = 24;
const BASE_CONFIG = Object.freeze({
  count: 1000, radius: .25, density: 1, G: 1, virial: 0, rotation: 0,
  restitution: 1, seed: 42, maxDt: .016, travelFraction: .2, theta: 0,
});
const SCENARIOS = [
  { id: 'uniform', label: '均匀球云', distribution: 'uniform', packing: .025 },
  { id: 'shell-low', label: '均匀球壳 · φ = 0.005', distribution: 'shell', packing: .005 },
  { id: 'symmetric-shell', label: '对称球壳', distribution: 'symmetric-shell', packing: .025 },
  { id: 'shell-sparsest', label: '均匀球壳 · φ = 0.001', distribution: 'shell', packing: .001 },
];
const BACKENDS = [
  { id: 'cpu-direct', label: 'CPU direct + CPU CCD', forcePrecision: 'f64', integrationPrecision: 'f64' },
  { id: 'gpu-force-cpu-ccd', label: 'GPU force + CPU CCD', forcePrecision: 'f32', integrationPrecision: 'f64' },
  { id: 'gpu-resident', label: 'GPU resident · final snapshot', forcePrecision: 'f32', integrationPrecision: 'f32', snapshotHz: 0 },
  { id: 'gpu-resident-30hz', label: 'GPU resident · about 30 Hz snapshots', forcePrecision: 'f32', integrationPrecision: 'f32', snapshotHz: 30 },
];
const clock = () => performance.now();
const messageOf = error => error?.message || String(error);
let active = false;

function configFor(scenario) {
  return { ...BASE_CONFIG, distribution: scenario.distribution, packing: scenario.packing };
}

function commonFor(scenario, backend) {
  return {
    caseId: `${scenario.id}/${backend.id}`,
    scenario: scenario.id, scenarioLabel: scenario.label,
    backend: backend.id, backendLabel: backend.label,
    forcePrecision: backend.forcePrecision, integrationPrecision: backend.integrationPrecision,
    snapshotHz: backend.snapshotHz || 0, config: configFor(scenario),
  };
}

function diagnosticsFor(simulation) {
  const started = clock();
  try {
    const stats = simulation.stats(true);
    const sampledForceErrorRMS = sampleForceError(
      simulation.positions, simulation.count, simulation.config.G * simulation.mass,
      0, simulation.accelerations, FORCE_SAMPLES, true);
    return {
      elapsedMs: clock() - started, energy: stats.energy, energyDrift: stats.energyDrift,
      momentumError: stats.momentumError, sampledForceErrorRMS, forceSampleCount: FORCE_SAMPLES,
      kinetic: stats.kinetic, potential: stats.potential,
      collisionEnergyLoss: simulation._collisionEnergyLoss,
    };
  } catch (error) { return { elapsedMs: clock() - started, diagnosticError: messageOf(error) }; }
}

async function createBackend(backend) {
  if (backend.id === 'cpu-direct') {
    return {
      async prepare(simulation) {
        if (!simulation._prepareInitialContacts()) throw new Error(simulation.detail || 'Initial contacts could not be prepared.');
        simulation._computeForces();
        simulation._setBaseline();
      },
      advance: (simulation, duration) => simulation.advance(duration, Infinity),
      snapshot: async simulation => simulation,
      dispose() {},
    };
  }
  if (backend.id === 'gpu-force-cpu-ccd') {
    const solver = await createWebGPUForceSolver();
    const evaluate = async simulation => {
      await solver.compute(simulation.positions, simulation.count, simulation.config.G * simulation.mass, simulation.accelerations);
      simulation.forcePrecision = 'f32';
    };
    return {
      async prepare(simulation) {
        if (!simulation._prepareInitialContacts()) throw new Error(simulation.detail || 'Initial contacts could not be prepared.');
        await evaluate(simulation);
        simulation._lastForceEvaluator = evaluate;
        simulation._setBaseline();
      },
      advance: (simulation, duration) => simulation.advanceAsync(duration, Infinity, evaluate),
      snapshot: async simulation => simulation,
      dispose: () => solver.dispose(),
    };
  }
  const solver = await createWebGPUSimulation();
  return {
    metrics: solver.metrics,
    prepare: simulation => solver.upload(simulation),
    advance: (_simulation, duration) => solver.advance(duration, Infinity),
    snapshot: () => solver.readSnapshot(),
    dispose: () => solver.dispose(),
  };
}

async function run(environment) {
  const records = [];
  const record = value => { records.push(value); self.postMessage({ type: 'record', record: value }); };
  const progress = message => self.postMessage({ type: 'progress', message });
  record({
    kind: 'environment', startedAt: new Date().toISOString(),
    environment: { ...environment, workerUserAgent: navigator.userAgent, workerWebgpuExposed: Boolean(navigator.gpu) },
    scenarios: SCENARIOS, backends: BACKENDS, targetSeconds: TARGET_SECONDS,
    warmupSeconds: WARMUP_SECONDS, chunkSeconds: CHUNK_SECONDS,
    completionToleranceSeconds: TIME_TOLERANCE, wallLimitMs: WALL_LIMIT_MS,
    measuredWork: 'advance calls including scalar readback; periodic body snapshots included only for the 30 Hz case',
    excludedWork: 'setup, independent-state warmup, final full snapshot, diagnostics',
  });

  for (const scenario of SCENARIOS) for (const backend of BACKENDS) {
    const common = commonFor(scenario, backend);
    self.postMessage({ type: 'case-start', case: common });
    progress(`初始化与热身：${scenario.label} / ${backend.label}`);
    let implementation = null, simulation = null, setupStarted = clock();
    let integrationStarted = null, elapsedMs = null, failure = null;
    let bodySnapshotTime = null, finalSnapshotMs = null;
    let periodicSnapshots = 0, periodicSnapshotMs = 0, lastAdvanceSeconds = null;
    try {
      implementation = await createBackend(backend);
      const warmup = new Simulation(configFor(scenario));
      await implementation.prepare(warmup);
      record({ kind: 'setup', ...common, phase: 'warmup-state', status: 'completed', elapsedMs: clock() - setupStarted });
      const warmupStarted = clock();
      while (warmup.time < WARMUP_SECONDS - TIME_TOLERANCE && warmup.status !== 'stopped') {
        const advanced = await implementation.advance(warmup, Math.min(CHUNK_SECONDS, WARMUP_SECONDS - warmup.time));
        if (!(advanced > 0)) break;
        if (clock() - warmupStarted >= WALL_LIMIT_MS) break;
      }
      await implementation.snapshot(warmup);
      record({
        kind: 'warmup', ...common, status: warmup.time >= WARMUP_SECONDS - TIME_TOLERANCE ? 'completed' : 'incomplete',
        targetSeconds: WARMUP_SECONDS, simulatedSeconds: warmup.time, elapsedMs: clock() - warmupStarted,
        acceptedSteps: warmup.acceptedSteps, collisions: warmup.collisions, retries: warmup.retries,
      });
      setupStarted = clock();
      simulation = new Simulation(configFor(scenario));
      await implementation.prepare(simulation);
      bodySnapshotTime = simulation.time;
      record({ kind: 'setup', ...common, phase: 'measured-state', status: 'completed', elapsedMs: clock() - setupStarted });

      progress(`推进计时：${scenario.label} / ${backend.label}`);
      integrationStarted = clock();
      const intervalMs = backend.snapshotHz ? 1000 / backend.snapshotHz : Infinity;
      let nextSnapshotAt = integrationStarted + intervalMs;
      let lastProgressAt = integrationStarted;
      while (simulation.time < TARGET_SECONDS - TIME_TOLERANCE && simulation.status !== 'stopped'
        && clock() - integrationStarted < WALL_LIMIT_MS) {
        lastAdvanceSeconds = await implementation.advance(simulation, Math.min(CHUNK_SECONDS, TARGET_SECONDS - simulation.time));
        if (!(lastAdvanceSeconds > 0)) break;
        if (backend.snapshotHz && clock() >= nextSnapshotAt && simulation.time < TARGET_SECONDS - TIME_TOLERANCE) {
          const snapshotStarted = clock();
          await implementation.snapshot(simulation);
          periodicSnapshotMs += clock() - snapshotStarted;
          periodicSnapshots++;
          bodySnapshotTime = simulation.time;
          nextSnapshotAt = clock() + intervalMs;
        }
        if (clock() - lastProgressAt > 500) {
          progress(`推进计时：${scenario.label} / ${backend.label} · ${simulation.time.toFixed(3)} / 1.000 s`);
          lastProgressAt = clock();
        }
      }
      elapsedMs = clock() - integrationStarted;
      const snapshotStarted = clock();
      await implementation.snapshot(simulation);
      finalSnapshotMs = clock() - snapshotStarted;
      bodySnapshotTime = simulation.time;
    } catch (error) {
      failure = messageOf(error);
      if (elapsedMs === null && integrationStarted !== null) elapsedMs = clock() - integrationStarted;
      if (integrationStarted === null) record({ kind: 'setup', ...common, status: 'error', elapsedMs: clock() - setupStarted, detail: failure });
    } finally {
      const completed = simulation && simulation.time >= TARGET_SECONDS - TIME_TOLERANCE;
      const status = failure ? 'error' : completed ? 'completed' : simulation?.status === 'stopped' ? 'stopped'
        : elapsedMs >= WALL_LIMIT_MS ? 'wall-limit' : 'no-progress';
      const bodiesCurrent = backend.integrationPrecision === 'f64'
        || (simulation && bodySnapshotTime !== null && Math.abs(simulation.time - bodySnapshotTime) <= TIME_TOLERANCE);
      record({
        kind: 'integration', ...common, status, targetSeconds: TARGET_SECONDS,
        simulatedSeconds: simulation?.time ?? 0, elapsedMs,
        coreMultiplier: elapsedMs > 0 ? simulation.time * 1000 / elapsedMs : null,
        acceptedSteps: simulation?.acceptedSteps ?? null, collisions: simulation?.collisions ?? null,
        retries: simulation?.retries ?? null, simulationStatus: simulation?.status ?? null,
        gpuMetrics: implementation?.metrics ? { ...implementation.metrics } : null,
        ccdStatus: simulation?.ccdStatus ?? null, lastAdvanceSeconds,
        periodicSnapshots, periodicSnapshotMs, finalSnapshotMs, bodySnapshotTime,
        detail: failure || simulation?.detail || null,
        diagnostics: simulation && bodiesCurrent ? diagnosticsFor(simulation)
          : { unavailable: 'A complete current body snapshot was not obtained.' },
      });
      try { implementation?.dispose(); }
      catch (error) { record({ kind: 'dispose', ...common, status: 'error', detail: messageOf(error) }); }
      self.postMessage({ type: 'case-end', caseId: common.caseId });
    }
  }
  self.postMessage({ type: 'done', recordCount: records.length });
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'run' || active) return;
  active = true;
  try { await run(data.environment ?? {}); }
  catch (error) { self.postMessage({ type: 'error', message: messageOf(error) }); }
  finally { active = false; }
};

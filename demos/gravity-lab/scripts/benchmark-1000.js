// Performance timing only: no assertions and no automatic/browser tests.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const source = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../src/physics/', import.meta.url));
const snapshotDirectory = process.argv[3] ? resolve(process.argv[3]) : null;
if (snapshotDirectory) mkdirSync(snapshotDirectory, { recursive: true });
const { Simulation } = await import(pathToFileURL(`${source}/simulation.js`));
const { computeForces } = await import(pathToFileURL(`${source}/forces.js`));
const { continuousDrift, createCollisionWorkspace } = await import(pathToFileURL(`${source}/collisions.js`));
const scenarios = [
  { name: 'uniform', config: { distribution: 'uniform', packing: .025 } },
  { name: 'shell-low', config: { distribution: 'shell', packing: .005 } },
  { name: 'symmetric-shell', config: { distribution: 'symmetric-shell', packing: .025 } },
  { name: 'uniform-dense-e05', duration: 1, config: { distribution: 'uniform', packing: .06, restitution: .5 } },
];
console.log(JSON.stringify({ runtime: process.version, cpu: os.cpus()[0].model, source }));
for (const scenario of scenarios) {
  const simulation = new Simulation({ count: 1000, seed: 42, ...scenario.config });
  // Exclude initialisation and JIT warmup from steady-state kernel timing.
  simulation.advance(1e-8, Infinity);
  const out = new Float64Array(3000);
  for (let i = 0; i < 40; i++) computeForces(simulation.positions, simulation.count, simulation.config.G * simulation.mass, simulation.config.theta, out);
  const forceStarted = performance.now();
  for (let i = 0; i < 300; i++) computeForces(simulation.positions, simulation.count, simulation.config.G * simulation.mass, simulation.config.theta, out);
  const forceMs = (performance.now() - forceStarted) / 300;

  const duration = scenario.duration ?? 3;
  const before = simulation.time, started = performance.now();
  while (simulation.time - before < duration - 1e-12 && simulation.status !== 'stopped' && performance.now() - started < 15000) {
    // Fixed chunk boundaries keep the core workload independent of CPU speed;
    // the separate Worker timing measures the real scheduling budget.
    simulation.advance(Math.min(.1, duration - (simulation.time - before)), Infinity);
  }
  const elapsedMs = performance.now() - started;
  const stats = simulation.stats(true);

  // Reuse a captured baseline state when comparing CCD implementations so
  // timing covers identical trajectories, even when integration steps differ.
  let driftPositions = simulation.positions, driftVelocities = simulation.velocities;
  if (snapshotDirectory) {
    const path = `${snapshotDirectory}/${scenario.name}.json`;
    if (existsSync(path)) {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      driftPositions = Float64Array.from(saved.positions);
      driftVelocities = Float64Array.from(saved.velocities);
    } else writeFileSync(path, JSON.stringify({ positions: [...driftPositions], velocities: [...driftVelocities] }));
  }

  // Isolate CCD using the same evolved state on each invocation. A 16 ms
  // ballistic drift stresses multiple events without extra gravity calls.
  const positions = new Float64Array(simulation.positions.length), velocities = new Float64Array(simulation.velocities.length);
  const workspace = createCollisionWorkspace?.(simulation.count);
  let driftEvents = 0, driftOk = true;
  for (let i = 0; i < 20; i++) {
    positions.set(driftPositions); velocities.set(driftVelocities);
    continuousDrift(positions, velocities, simulation.count, simulation.radius, .016, { restitution: simulation.config.restitution, workspace });
  }
  const driftStarted = performance.now();
  for (let i = 0; i < 100; i++) {
    positions.set(driftPositions); velocities.set(driftVelocities);
    const result = continuousDrift(positions, velocities, simulation.count, simulation.radius, .016, { restitution: simulation.config.restitution, workspace });
    driftEvents = result.events; driftOk = result.ok;
  }
  const driftMs = (performance.now() - driftStarted) / 100;
  console.log(JSON.stringify({
    name: scenario.name, config: simulation.config,
    forceMs, driftMs, driftEvents, driftOk,
    elapsedMs, targetSeconds: duration, simulatedSeconds: simulation.time - before,
    coreMultiplier: (simulation.time - before) * 1000 / elapsedMs,
    collisions: simulation.collisions, steps: simulation.acceptedSteps, retries: simulation.retries,
    energyDrift: stats.energyDrift, momentumError: stats.momentumError, forceError: stats.forceError,
    status: simulation.status,
  }));
}

// Explicit CPU timing only. This is not an assertion/acceptance test.
// Usage: node scripts/benchmark.js --count=1000 --steps=60 --runs=3 [--collisions]
import { performance } from 'node:perf_hooks';
import { Simulation } from '../src/physics/simulation.js';
import { FIXED_TIMESTEP } from '../src/physics/timestep.js';
import { MIN_PARTICLES, MAX_PARTICLES } from '../src/physics/limits.js';
import { PARTICLE_RADIUS, PARTICLE_MASS } from '../src/physics/constants.js';

function integerOption(name, fallback, min, max) {
  const option = process.argv.slice(2).find(value => value.startsWith(`--${name}=`));
  const value = option ? Number(option.slice(name.length + 3)) : fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  return value;
}
const count = integerOption('count', 1000, MIN_PARTICLES, MAX_PARTICLES);
const steps = integerOption('steps', 60, 1, 36000);
const runs = integerOption('runs', 3, 1, 100);
const collisionless = !process.argv.includes('--collisions');
const config = { count, collisionless, distribution: 'shell', seed: 42, packing: .025, virial: 0, G: 1 };
const records = [];
for (let run = 0; run < runs; run++) {
  const initialAt = performance.now();
  const simulation = new Simulation(config);
  const initializeMs = performance.now() - initialAt;
  const started = performance.now();
  const result = simulation.advanceSteps(steps, Infinity);
  const elapsedMs = performance.now() - started;
  records.push({ run: run + 1, initializeMs, elapsedMs, acceptedSteps: result.advancedSteps,
    actualMultiplier: result.advanced / (elapsedMs / 1000), msPerStep: result.advancedSteps ? elapsedMs / result.advancedSteps : null,
    collisions: simulation.collisions, status: simulation.status, detail: simulation.detail });
}
const sorted = records.map(row => row.actualMultiplier).sort((a, b) => a - b);
const mid = Math.floor(sorted.length / 2);
console.log(JSON.stringify({ backend: 'CPU Float64 direct sum', count, collisionless, dt: FIXED_TIMESTEP,
  parameters: { ...config, radius: PARTICLE_RADIUS, mass: PARTICLE_MASS },
  requestedSteps: steps, node: process.version, platform: process.platform, architecture: process.arch,
  measuredWork: 'Fixed-step CPU KDK including first acceleration; no rendering, reference diagnostics or GPU work. Fresh deterministic initial state per run; no warm-up excluded.',
  medianActualMultiplier: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, records }, null, 2));

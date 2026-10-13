import { Simulation } from '../src/physics/simulation.js';

const duration = Number(process.argv[2] || 2);
if (!Number.isFinite(duration) || duration <= 0 || duration > 60) {
  throw new Error('Provide a simulated duration between 0 and 60 seconds.');
}
for (const count of [2, 128, 384, 768, 1000]) {
  const simulation = new Simulation({ count, seed: 42 });
  const initial = simulation.stats(true);
  const start = performance.now();
  let batches = 0;
  while (simulation.time < duration && simulation.status !== 'stopped') {
    simulation.advance(Math.min(0.05, duration - simulation.time), Infinity);
    batches++;
  }
  const elapsed = (performance.now() - start) / 1000;
  const stats = simulation.stats(true);
  console.log(JSON.stringify({
    count, distribution: simulation.config.distribution,
    simulatedSeconds: Number(simulation.time.toFixed(3)),
    wallSeconds: Number(elapsed.toFixed(3)),
    computeSimulationRate: Number((simulation.time / elapsed).toFixed(2)),
    meanBatchMs: Number((elapsed * 1000 / batches).toFixed(2)),
    collisions: simulation.collisions,
    energyDriftPercent: Number((stats.energyDrift * 100).toFixed(4)),
    sampleForceErrorPercent: Number((stats.forceError * 100).toFixed(4)),
    initialForceErrorPercent: Number((initial.forceError * 100).toFixed(4)),
    status: simulation.status,
  }));
}

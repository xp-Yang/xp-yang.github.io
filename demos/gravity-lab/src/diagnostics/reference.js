import { potentialEnergy, sampleForceError } from '../physics/forces.js';

function motion(snapshot) {
  const { velocities, mass } = snapshot;
  let kinetic = 0, px = 0, py = 0, pz = 0, momentumScale = 0;
  for (let p = 0; p < velocities.length; p += 3) {
    const x = velocities[p], y = velocities[p + 1], z = velocities[p + 2];
    kinetic += .5 * mass * (x * x + y * y + z * z);
    px += mass * x; py += mass * y; pz += mass * z;
    momentumScale += mass * Math.hypot(x, y, z);
  }
  return { kinetic, momentum: [px, py, pz], momentumScale: Math.max(momentumScale, mass, 1e-20) };
}

function conservedState(snapshot, config) {
  const result = motion(snapshot);
  const softening = config.collisionless ? config.softeningRatio * snapshot.radius : 0;
  const potential = potentialEnergy(snapshot.positions, snapshot.count, config.G, snapshot.mass, softening);
  const energy = result.kinetic + potential;
  return { ...result, softening, potential: Number.isFinite(potential) ? potential : null,
    energy: Number.isFinite(energy) ? energy : null };
}

/** Baseline belongs to the immutable initial accepted state, never panel-open time. */
export function createBaseline(snapshot, config = snapshot.config) {
  const state = conservedState(snapshot, config);
  return { energy: state.energy, scale: state.energy === null ? null : Math.max(state.kinetic + Math.abs(state.potential), 1e-20),
    momentum: state.momentum, momentumScale: state.momentumScale,
    collisionEnergyLoss: snapshot.collisionEnergyLoss ?? 0, acceptedSteps: snapshot.acceptedSteps, time: snapshot.time };
}

export function referenceDiagnostics(snapshot, config = snapshot.config, baseline = null) {
  const state = conservedState(snapshot, config);
  const loss = (snapshot.collisionEnergyLoss ?? 0) - (baseline?.collisionEnergyLoss ?? 0);
  const energyDrift = baseline?.energy != null && state.energy !== null
    ? (state.energy + loss - baseline.energy) / baseline.scale : null;
  const momentumError = baseline ? Math.hypot(...state.momentum.map((x, k) => x - baseline.momentum[k])) / baseline.momentumScale : null;
  const accelerations = snapshot.accelerations ?? snapshot.sampleAccelerations;
  const forceError = sampleForceError(snapshot.positions, snapshot.count, config.G * snapshot.mass,
    accelerations, snapshot.sampleIndices, state.softening);
  return { kinetic: state.kinetic, potential: state.potential, energy: state.energy,
    energyDrift: Number.isFinite(energyDrift) ? energyDrift : null,
    momentumError: Number.isFinite(momentumError) ? momentumError : null, forceError,
    time: snapshot.time, acceptedSteps: snapshot.acceptedSteps, collisions: snapshot.collisions,
    collisionEnergyLoss: snapshot.collisionEnergyLoss, precision: snapshot.precision,
    diagnosticsTime: globalThis.performance?.now() ?? Date.now() };
}

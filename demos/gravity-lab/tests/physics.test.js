import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, directForces } from '../src/physics/simulation.js';
import { timeOfImpact, createContinuousDrift, continueContinuousDrift } from '../src/physics/collisions.js';
import { FIXED_TIMESTEP } from '../src/physics/timestep.js';
import { createBaseline, referenceDiagnostics } from '../src/diagnostics/reference.js';

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const fixture = (config, positions, velocities) => Simulation.restore({
  positions: Float64Array.from(positions), velocities: Float64Array.from(velocities),
  acceptedSteps: 0, collisions: 0, collisionEnergyLoss: 0,
}, { G: 0, collisionless: false, ...config });
const baseline = simulation => createBaseline(simulation.snapshot(), simulation.config);
const diagnostics = (simulation, initial) => referenceDiagnostics(simulation.snapshot(), simulation.config, initial);
function completeDrift(positions, velocities, count, radius, duration) {
  return continueContinuousDrift(createContinuousDrift(positions, velocities, count, radius, duration), Infinity);
}
function minDistance(s) {
  let minimum = Infinity;
  for (let i = 0; i < s.count; i++) for (let j = i + 1; j < s.count; j++) {
    minimum = Math.min(minimum, Math.hypot(...[0, 1, 2].map(k => s.positions[j * 3 + k] - s.positions[i * 3 + k])));
  }
  return minimum;
}

test('all five supported distributions initialise without overlap and reproduce their seed', () => {
  for (const distribution of ['uniform', 'shell', 'disk', 'symmetric-shell', 'ring']) {
    const config = { count: 160, distribution, packing: .06, seed: 77, virial: .7, G: 1 };
    const a = new Simulation(config), b = new Simulation(config);
    assert.deepEqual(a.positions, b.positions);
    assert.deepEqual(a.velocities, b.velocities);
    assert.ok(minDistance(a) >= 2 * a.radius);
    const stats = diagnostics(a, baseline(a));
    near(2 * stats.kinetic / Math.abs(stats.potential), .7, 1e-12);
  }
});

test('reference G = 1 preserves the same nonzero initial velocities when actual gravity is zero', () => {
  const config = { count: 32, virial: .7, seed: 77 };
  const zero = new Simulation({ ...config, G: 0 }), one = new Simulation({ ...config, G: 1 });
  assert.deepEqual(zero.positions, one.positions);
  assert.deepEqual(zero.velocities, one.velocities);
  assert.ok(zero.velocities.some(value => value !== 0));
});

test('head-on contact exchanges equal-mass velocities and preserves kinetic energy and momentum', () => {
  const s = fixture({}, [-2, 0, 0, 2, 0, 0], [1, 0, 0, -1, 0, 0]);
  const initial = baseline(s);
  s.advanceSteps(180, Infinity);
  near(s.velocities[0], -1); near(s.velocities[3], 1);
  near(s.positions[0], -1.5); near(s.positions[3], 1.5);
  assert.equal(s.collisions, 1);
  near(diagnostics(s, initial).energyDrift, 0);
  near(diagnostics(s, initial).momentumError, 0);
});

test('oblique three-dimensional impact keeps tangential relative velocity and conserves motion', () => {
  const s = fixture({}, [-2, -.1, -.05, 2, .1, .05], [1, .1, .2, -1, .1, .2]);
  const initial = baseline(s), initialEnergy = diagnostics(s, initial).kinetic;
  s.advanceSteps(180, Infinity);
  const stats = diagnostics(s, initial);
  assert.equal(s.collisions, 1);
  near(stats.kinetic, initialEnergy, 1e-10);
  near(stats.momentumError, 0, 1e-12);
  near(s.velocities[1] + s.velocities[4], .2, 1e-12);
  near(s.velocities[2] + s.velocities[5], .4, 1e-12);
  assert.ok(Math.abs(s.velocities[1] - .1) > .1);
  assert.ok(minDistance(s) >= .5 - 1e-10);
});

test('continuous detection handles crossing trajectories whose endpoints do not overlap', () => {
  near(timeOfImpact(10, 0, 0, -200, 0, 0, 1, .1), .045);
  const positions = new Float64Array([-5, 0, 0, 5, 0, 0]);
  const velocities = new Float64Array([100, 0, 0, -100, 0, 0]);
  const collision = completeDrift(positions, velocities, 2, .5, .1);
  assert.equal(collision.events, 1);
  near(positions[0], -6); near(positions[3], 6);
  const s = fixture({}, [-5, 0, 0, 5, 0, 0], [100, 0, 0, -100, 0, 0]);
  s.advanceSteps(6, Infinity);
  assert.equal(s.collisions, 1);
  near(s.velocities[0], -100); near(s.velocities[3], 100);
  near(s.positions[0], -5.5, 1e-9); near(s.positions[3], 5.5, 1e-9);
});

test('simultaneous touching contacts resolve deterministically without overlap or damping', () => {
  const s = fixture({}, [-.5, 0, 0, 0, 0, 0, .5, 0, 0], [1, 0, 0, 0, 0, 0, -1, 0, 0]);
  const initial = baseline(s);
  s.advanceSteps(12, Infinity);
  assert.ok(s.collisions >= 3);
  near(s.velocities[0], -1); near(s.velocities[3], 0); near(s.velocities[6], 1);
  assert.ok(minDistance(s) >= .5 - 1e-12);
  near(diagnostics(s, initial).energyDrift, 0, 1e-12);
});

test('a free-space particle flies arbitrarily far without any wall or deletion', () => {
  const s = fixture({}, [0, 0, 0, 0, 20, 0], [12, 3, 4, -2, 0, 0]);
  s.advanceSteps(600, Infinity);
  near(s.positions[0], 120, 1e-8); near(s.positions[1], 30, 1e-8); near(s.positions[2], 40, 1e-8);
  assert.equal(s.count, 2); assert.equal(s.collisions, 0);
});

test('collision candidates are reconsidered after an impulse causes another impact', () => {
  const p = new Float64Array([-2, 0, 0, 0, 0, 0, 2, 0, 0]);
  const v = new Float64Array([3, 0, 0, 0, 0, 0, 0, 0, 0]);
  const result = completeDrift(p, v, 3, .5, 1);
  assert.equal(result.ok, true);
  assert.equal(result.events, 2);
  near(v[0], 0); near(v[3], 0); near(v[6], 3);
  near(p[0], -1); near(p[3], 1); near(p[6], 3);
});

test('direct forces obey equal and opposite interactions', () => {
  const s = new Simulation({ count: 192, seed: 17 });
  const exact = directForces(s.positions, s.count, 1, undefined, s.softeningLength);
  const sum = [0, 0, 0];
  for (let p = 0; p < exact.length; p++) sum[p % 3] += exact[p];
  assert.ok(Math.hypot(...sum) < 1e-10);
});

test('fixed-step two-body circular orbit stays near its analytic trajectory', () => {
  const config = { G: 10 };
  const initialState = fixture(config, [-3, 0, 0, 3, 0, 0], [0, 0, 0, 0, 0, 0]);
  const speed = Math.sqrt(config.G * initialState.mass / 12), omega = speed / 3;
  const s = fixture(config, [-3, 0, 0, 3, 0, 0], [0, 0, -speed, 0, 0, speed]);
  const initial = baseline(s);
  s.advanceSteps(600, Infinity);
  const angle = omega * s.time;
  assert.ok(Math.hypot(s.positions[0] + 3 * Math.cos(angle), s.positions[1], s.positions[2] + 3 * Math.sin(angle)) < 1e-5);
  assert.ok(Math.abs(diagnostics(s, initial).energyDrift) < 1e-6);
  assert.ok(diagnostics(s, initial).momentumError < 1e-12);
});

test('repeated gravity-driven elastic rebounds remain separate without artificial collision dissipation', () => {
  const s = fixture({ G: 4 }, [-1.2, 0, 0, 1.2, 0, 0], [0, 0, 0, 0, 0, 0]);
  const initial = baseline(s);
  let closest = Infinity;
  for (let i = 0; i < 400; i++) {
    s.advanceSteps(6, Infinity);
    closest = Math.min(closest, minDistance(s));
    assert.equal(s.status, 'running');
  }
  assert.ok(s.collisions >= 3);
  assert.ok(closest >= .5 - 1e-9);
  near(s.collisionEnergyLoss, 0);
  near(diagnostics(s, initial).momentumError, 0, 1e-12);
});

test('zero compute budget does not advance or enlarge the fixed physical step', () => {
  const s = new Simulation({ count: 128 });
  const positions = s.positions.slice();
  const waiting = s.advanceSteps(600, 0);
  assert.equal(waiting.advancedSteps, 0);
  assert.equal(s.time, 0);
  assert.deepEqual(s.positions, positions);
  const actual = s.advanceSteps(1, Infinity);
  assert.equal(actual.advancedSteps, 1);
  near(actual.advanced, FIXED_TIMESTEP);
  assert.equal(s.acceptedSteps, 1); assert.equal(s.count, 128);
});

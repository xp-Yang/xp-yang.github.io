import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, computeForces } from '../src/physics/simulation.js';
import { timeOfImpact, continuousDrift } from '../src/physics/collisions.js';

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const two = (config, p, v) => new Simulation({ count: 2, radius: .5, G: 0, theta: 0, ...config }).setState(p, v);
function minDistance(s) {
  let minimum = Infinity;
  for (let i = 0; i < s.count; i++) for (let j = i + 1; j < s.count; j++) {
    minimum = Math.min(minimum, Math.hypot(...[0, 1, 2].map(k => s.positions[j * 3 + k] - s.positions[i * 3 + k])));
  }
  return minimum;
}

test('all five three-dimensional distributions initialise without overlap and reproduce their seed', () => {
  for (const distribution of ['uniform', 'gaussian', 'disk', 'shell', 'binary']) {
    const a = new Simulation({ count: 160, distribution, packing: .06, seed: 77 });
    const b = new Simulation({ count: 160, distribution, packing: .06, seed: 77 });
    assert.deepEqual(a.positions, b.positions);
    assert.deepEqual(a.velocities, b.velocities);
    assert.ok(minDistance(a) >= 2 * a.radius);
    const stats = a.stats(true);
    near(2 * stats.kinetic / Math.abs(stats.potential), .7, 1e-12);
  }
});

test('head-on contact exchanges equal-mass velocities and preserves kinetic energy and momentum', () => {
  const s = two({}, [-2, 0, 0, 2, 0, 0], [1, 0, 0, -1, 0, 0]);
  s.advance(3, Infinity);
  near(s.velocities[0], -1); near(s.velocities[3], 1);
  near(s.positions[0], -2); near(s.positions[3], 2);
  assert.equal(s.collisions, 1);
  near(s.stats(true).energyDrift, 0);
  near(s.stats(true).momentumError, 0);
});

test('oblique three-dimensional impact keeps tangential relative velocity and conserves motion', () => {
  const s = two({}, [-2, -.25, -.15, 2, .25, .15], [1, .1, .2, -1, .1, .2]);
  const initialEnergy = s.stats(true).kinetic;
  s.advance(3, Infinity);
  const stats = s.stats(true);
  assert.equal(s.collisions, 1);
  near(stats.kinetic, initialEnergy, 1e-10);
  near(stats.momentumError, 0, 1e-12);
  near(s.velocities[1] + s.velocities[4], .2, 1e-12);
  near(s.velocities[2] + s.velocities[5], .4, 1e-12);
  assert.ok(Math.abs(s.velocities[1] - .1) > .1);
  assert.ok(minDistance(s) >= 1 - 1e-10);
});

test('continuous detection handles crossing trajectories whose endpoints do not overlap', () => {
  near(timeOfImpact(10, 0, 0, -200, 0, 0, 1, .1), .045);
  const positions = new Float64Array([-5, 0, 0, 5, 0, 0]);
  const velocities = new Float64Array([100, 0, 0, -100, 0, 0]);
  const collision = continuousDrift(positions, velocities, 2, .5, .1);
  assert.equal(collision.events, 1);
  near(positions[0], -6); near(positions[3], 6);
  const s = two({ maxDt: .1, travelFraction: .4 }, [-5, 0, 0, 5, 0, 0], [100, 0, 0, -100, 0, 0]);
  s.advance(.1, Infinity);
  assert.equal(s.collisions, 1);
  near(s.velocities[0], -100); near(s.velocities[3], 100);
  near(s.positions[0], -6, 1e-9); near(s.positions[3], 6, 1e-9);
});

test('rotation slider allocates its stated fraction of the total kinetic energy', () => {
  const s = new Simulation({ count: 160, rotation: .45, virial: .7 });
  let rotation2 = 0, dot = 0;
  for (let p = 0; p < s.positions.length; p += 3) {
    rotation2 += s.positions[p] ** 2 + s.positions[p + 2] ** 2;
    dot += s.velocities[p] * s.positions[p + 2] - s.velocities[p + 2] * s.positions[p];
  }
  const rotationEnergy = .5 * s.mass * dot * dot / rotation2;
  near(rotationEnergy / s.stats(true).kinetic, .45, 1e-12);
});

test('simultaneous touching contacts resolve deterministically without overlap or damping', () => {
  const s = two({}, [-1, 0, 0, 0, 0, 0, 1, 0, 0], [1, 0, 0, 0, 0, 0, -1, 0, 0]);
  s.advance(.2, Infinity);
  assert.ok(s.collisions >= 3);
  near(s.velocities[0], -1); near(s.velocities[3], 0); near(s.velocities[6], 1);
  assert.ok(minDistance(s) >= 1 - 1e-12);
  near(s.stats(true).energyDrift, 0, 1e-12);
});

test('a free-space particle flies arbitrarily far without any wall or deletion', () => {
  const s = two({}, [0, 0, 0, 0, 20, 0], [12, 3, 4, -2, 0, 0]);
  s.advance(10, Infinity);
  near(s.positions[0], 120, 1e-8); near(s.positions[1], 30, 1e-8); near(s.positions[2], 40, 1e-8);
  assert.equal(s.count, 2); assert.equal(s.collisions, 0);
});

test('swept broad phase finds fast balls before their non-overlapping endpoints', () => {
  const p = new Float64Array([-5, 0, 0, 5, 0, 0]);
  const v = new Float64Array([100, 0, 0, -100, 0, 0]);
  const result = continuousDrift(p, v, 2, .5, .1);
  assert.equal(result.ok, true);
  assert.equal(result.events, 1);
  near(p[0], -6); near(p[3], 6);
  near(v[0], -100); near(v[3], 100);
});

test('collision candidates are reconsidered after an impulse causes another impact', () => {
  const p = new Float64Array([-2, 0, 0, 0, 0, 0, 2, 0, 0]);
  const v = new Float64Array([3, 0, 0, 0, 0, 0, 0, 0, 0]);
  const result = continuousDrift(p, v, 3, .5, 1);
  assert.equal(result.ok, true);
  assert.equal(result.events, 2);
  near(v[0], 0); near(v[3], 0); near(v[6], 3);
  near(p[0], -1); near(p[3], 1); near(p[6], 3);
});

test('direct forces obey equal and opposite interactions; tighter tree opening reduces sample error', () => {
  const s = new Simulation({ count: 768, seed: 17 });
  const exact = computeForces(s.positions, s.count, 1, 0);
  const loose = computeForces(s.positions, s.count, 1, .8);
  const tight = computeForces(s.positions, s.count, 1, .25);
  const sum = [0, 0, 0];
  let looseError = 0, tightError = 0, reference = 0;
  for (let p = 0; p < exact.length; p++) {
    sum[p % 3] += exact[p];
    looseError += (loose[p] - exact[p]) ** 2;
    tightError += (tight[p] - exact[p]) ** 2;
    reference += exact[p] ** 2;
  }
  assert.ok(Math.hypot(...sum) < 1e-10);
  assert.ok(tightError < looseError);
  assert.ok(Math.sqrt(tightError / reference) < .005);
  s.configure({ theta: 0 });
  assert.equal(s.stats(true).forceError, 0);
});

test('two-body circular orbit converges at second order when the time step halves', () => {
  function orbit(dt) {
    const s = two({ radius: .4, density: 5, G: 30, maxDt: dt }, [-3, 0, 0, 3, 0, 0], [0, 0, 0, 0, 0, 0]);
    const speed = Math.sqrt(s.config.G * s.mass / 12), omega = speed / 3;
    s.setState([-3, 0, 0, 3, 0, 0], [0, 0, -speed, 0, 0, speed]);
    s.advance(Math.PI / (2 * omega), Infinity);
    return { error: Math.hypot(s.positions[0], s.positions[1], s.positions[2] + 3), stats: s.stats(true) };
  }
  const coarse = orbit(.04), fine = orbit(.02);
  assert.ok(coarse.error / fine.error > 3.4 && coarse.error / fine.error < 4.6);
  assert.ok(Math.abs(fine.stats.energyDrift) < 1e-5);
  assert.ok(fine.stats.momentumError < 1e-12);
});

test('repeated gravity-driven elastic rebounds remain separate and do not lose kinetic energy to damping', () => {
  const s = two({ radius: .3, G: 4, maxDt: .002 }, [-1.2, 0, 0, 1.2, 0, 0], [0, 0, 0, 0, 0, 0]);
  let closest = Infinity;
  for (let i = 0; i < 400; i++) { s.advance(.1, Infinity); closest = Math.min(closest, minDistance(s)); }
  assert.ok(s.collisions >= 3);
  assert.ok(closest >= .6 - 1e-9);
  assert.ok(Math.abs(s.stats(true).energyDrift) < .003);
  near(s.stats(true).momentumError, 0, 1e-12);
});

test('time budgets slow simulated time rather than enlarge steps or discard bodies', () => {
  const s = new Simulation({ count: 128, maxDt: .01 });
  const actual = s.advance(10, 0);
  assert.ok(actual > 0 && actual <= .01);
  assert.equal(s.acceptedSteps, 1); assert.equal(s.count, 128);
});

test('dense three-dimensional gravitational evolution preserves non-overlap through many impacts', () => {
  const s = new Simulation({ count: 128, distribution: 'gaussian', packing: .06, virial: .15, rotation: .2, maxDt: .008 });
  for (let k = 0; k < 200; k++) {
    s.advance(.01, Infinity);
    assert.ok(minDistance(s) >= 2 * s.radius - 1e-8);
    assert.equal(s.status, 'running');
  }
  assert.ok(s.collisions > 20);
  assert.ok(Math.abs(s.stats(true).energyDrift) < .005);
});

test('changing common density changes every sphere mass and resets the energy reference', () => {
  const s = new Simulation({ count: 128 });
  const previousMass = s.mass, positions = Float64Array.from(s.positions);
  s.configure({ density: 2 });
  near(s.mass, previousMass * 2);
  assert.deepEqual(s.positions, positions);
  near(s.stats(true).energyDrift, 0);
  assert.throws(() => s.setState([0, 0, 0, .1, 0, 0], [0, 0, 0, 0, 0, 0]), /overlap/);
});

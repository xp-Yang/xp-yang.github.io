import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampBlackHoleControls,
  DEFAULT_BLACK_HOLE_CONTROLS,
} from '../lib/black-hole/controls';
import {
  SCHWARZSCHILD,
  blackbodyLinearRgb,
  criticalImpactParameter,
  diskRedshiftFactor,
  findThinDiskPeak,
  novikovThorneFlux,
  orbitInvariant,
  rk4OrbitStep,
  thinDiskPeakTemperatureKelvin,
  traceImpactParameter,
} from '../lib/black-hole/physics';

test('RK4 restores the flat-space orbit equation when mass is zero', () => {
  const start = { u: 0, du: 0.2 };
  let state = start;
  const step = Math.PI / 2_000;
  for (let index = 0; index < 1_000; index += 1)
    state = rk4OrbitStep(state, step, 0);
  assert.ok(Math.abs(state.u - 0.2) < 1e-10);
  assert.ok(Math.abs(state.du) < 1e-10);
});

test('the circular photon orbit remains at r = 3M', () => {
  let state = { u: 1 / 3, du: 0 };
  const invariant = orbitInvariant(state);
  for (let index = 0; index < 1_000; index += 1)
    state = rk4OrbitStep(state, 0.01);
  assert.ok(Math.abs(state.u - 1 / 3) < 1e-12);
  assert.ok(Math.abs(orbitInvariant(state) - invariant) < 1e-12);
});

test('capture boundary brackets the Schwarzschild critical impact parameter', () => {
  const critical = criticalImpactParameter();
  const captured = traceImpactParameter(critical * 0.999);
  const escaped = traceImpactParameter(critical * 1.001);
  assert.equal(captured.captured, true);
  assert.equal(escaped.escaped, true);
  assert.ok(Math.max(captured.invariantDrift, escaped.invariantDrift) < 1e-9);
});

test('weak-field deflection approaches 4M/b', () => {
  const impact = 40;
  const curved = traceImpactParameter(impact, {
    startRadius: 10_000,
    deltaPhi: 0.0015,
  });
  const flat = traceImpactParameter(impact, {
    mass: 0,
    startRadius: 10_000,
    deltaPhi: 0.0015,
  });
  const measured = curved.phi - flat.phi;
  assert.ok(Math.abs(measured - 4 / impact) < 0.012, `measured ${measured}`);
});

test('Novikov-Thorne disk is dark at ISCO and peaks outside it', () => {
  assert.equal(novikovThorneFlux(SCHWARZSCHILD.iscoRadius), 0);
  const peak = findThinDiskPeak();
  assert.ok(peak.radius > SCHWARZSCHILD.iscoRadius && peak.radius < 14);
  assert.ok(peak.flux > novikovThorneFlux(SCHWARZSCHILD.diskOuterRadius));
  assert.ok(novikovThorneFlux(12) > novikovThorneFlux(18));
  const physicalTemperature = thinDiskPeakTemperatureKelvin();
  assert.ok(physicalTemperature > 60_000 && physicalTemperature < 90_000);
});

test('prograde photon angular momentum raises the observed disk frequency', () => {
  const common = { radius: 10, photonEnergyAtInfinity: 0.95 };
  const approaching = diskRedshiftFactor({
    ...common,
    photonAngularMomentumZ: 3,
  });
  const receding = diskRedshiftFactor({
    ...common,
    photonAngularMomentumZ: -3,
  });
  assert.ok(approaching > receding);
  assert.ok(approaching > 0 && receding > 0);
  assert.ok(approaching ** 4 > receding ** 4);
});

test('removing orbital angular momentum restores left-right redshift symmetry', () => {
  const common = { radius: 10, photonEnergyAtInfinity: 0.95 };
  const left = diskRedshiftFactor({ ...common, photonAngularMomentumZ: 0 });
  const right = diskRedshiftFactor({ ...common, photonAngularMomentumZ: -0 });
  assert.equal(left, right);
});

test('blackbody LUT shifts from warm to blue-white as temperature increases', () => {
  const warm = blackbodyLinearRgb(2_000);
  const hot = blackbodyLinearRgb(15_000);
  assert.ok(warm[0] > warm[2]);
  assert.ok(hot[2] > warm[2]);
});

test('disk temperature responds to mass and accretion controls', () => {
  const baseline = thinDiskPeakTemperatureKelvin(100_000_000, 0.1);
  assert.ok(thinDiskPeakTemperatureKelvin(10_000_000, 0.1) > baseline);
  assert.ok(thinDiskPeakTemperatureKelvin(100_000_000, 0.5) > baseline);
});

test('interactive black-hole parameters stay within render-safe bounds', () => {
  const clamped = clampBlackHoleControls({
    ...DEFAULT_BLACK_HOLE_CONTROLS,
    inclination: 120,
    observerRadius: 2,
    zoom: 9,
    diskOuterRadius: 4,
    exposure: -1,
  });

  assert.equal(clamped.inclination, 85);
  assert.equal(clamped.observerRadius, 10);
  assert.equal(clamped.zoom, 2.4);
  assert.equal(clamped.diskOuterRadius, 12);
  assert.equal(clamped.exposure, 0.25);
});

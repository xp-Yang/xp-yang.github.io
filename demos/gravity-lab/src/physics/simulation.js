import { directForces, potentialEnergy } from './forces.js';
import { createCollisionWorkspace, createContinuousDrift, continueContinuousDrift } from './collisions.js';
import { FIXED_TIMESTEP } from './timestep.js';
import { MIN_PARTICLES, MAX_PARTICLES } from './limits.js';
import { PARTICLE_RADIUS, PARTICLE_MASS } from './constants.js';

export { directForces } from './forces.js';
export { PARTICLE_RADIUS, PARTICLE_MASS } from './constants.js';

// Initial motion uses a fixed energy reference, independent of actual gravity.
const INITIAL_MOTION_REFERENCE_G = 1;

export const DEFAULT_CONFIG = Object.freeze({
  count: 384, packing: .025, virial: 0, distribution: 'symmetric-shell', seed: 42,
  G: 1, restitution: 1, collisionless: true, softeningRatio: 1,
});
const now = () => globalThis.performance?.now() ?? Date.now();
const clamp = (x, min, max) => Math.max(min, Math.min(max, Number(x)));
const DISTRIBUTIONS = ['uniform', 'shell', 'disk', 'symmetric-shell', 'ring'];
const CLOUD_REFERENCE_RADIUS = .45;

/** Only the currently supported product parameters enter the physical model. */
export function cleanConfig(input = {}) {
  const c = {};
  for (const [key, fallback] of Object.entries(DEFAULT_CONFIG)) c[key] = input[key] ?? fallback;
  for (const [key, fallback] of Object.entries(DEFAULT_CONFIG)) {
    if (typeof fallback === 'number' && !Number.isFinite(Number(c[key]))) throw new Error(`Invalid simulation parameter: ${key}`);
  }
  c.count = Math.round(clamp(c.count, MIN_PARTICLES, MAX_PARTICLES));
  c.packing = clamp(c.packing, .005, .06);
  c.virial = clamp(c.virial, 0, 2);
  c.G = clamp(c.G, 0, 10);
  c.restitution = clamp(c.restitution, 0, 1);
  c.softeningRatio = clamp(c.softeningRatio, .1, 5);
  c.collisionless = c.collisionless === true;
  c.seed = Math.round(clamp(c.seed, 1, 999999));
  if (!DISTRIBUTIONS.includes(c.distribution)) c.distribution = DEFAULT_CONFIG.distribution;
  return c;
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mirrored latitude rings on a unit sphere, with exactly the requested count. */
function symmetricShellPoints(count) {
  const parity = count % 2;
  const minimumEquator = Math.min(count, parity ? 3 : 4);
  // Similar meridional and longitudinal spacing; keep the equator and at
  // least three points per mirrored ring even for small particle counts.
  const halfBands = Math.max(0, Math.min(
    Math.round((Math.sqrt(count * Math.PI / 4) - 1) / 2),
    Math.floor((count - minimumEquator) / 6),
  ));
  const bands = halfBands * 2 + 1;
  const rings = Array.from({ length: halfBands }, (_, j) => {
    const latitudeAngle = (j + .5) * Math.PI / bands;
    return { horizontal: Math.sin(latitudeAngle), y: Math.cos(latitudeAngle), count: 3 };
  });
  const weight = 1 + 2 * rings.reduce((sum, ring) => sum + ring.horizontal, 0);
  // Mirrored rings consume pairs of particles, so the equatorial ring carries
  // the parity needed to support every integer count without dropping points.
  const equator = Math.max(minimumEquator, Math.min(
    count - 6 * halfBands,
    2 * Math.round((count / weight - parity) / 2) + parity,
  ));
  let remaining = (count - equator) / 2 - 3 * halfBands;
  while (remaining > 0) {
    let selected = 0, largestDeficit = -Infinity;
    for (let j = 0; j < rings.length; j++) {
      const deficit = count * rings[j].horizontal / weight - rings[j].count;
      if (deficit > largestDeficit) { selected = j; largestDeficit = deficit; }
    }
    rings[selected].count++;
    remaining--;
  }
  const points = new Float64Array(count * 3);
  let offset = 0;
  let minimumChord = 2 * Math.sin(Math.PI / equator);
  if (halfBands) minimumChord = Math.min(minimumChord, 2 * Math.sin(Math.PI / (2 * bands)));
  for (const ring of rings) {
    minimumChord = Math.min(minimumChord, 2 * ring.horizontal * Math.sin(Math.PI / ring.count));
    for (let j = 0; j < ring.count; j++) {
      const angle = 2 * Math.PI * j / ring.count;
      const x = ring.horizontal * Math.cos(angle), z = ring.horizontal * Math.sin(angle);
      points.set([x, ring.y, z, x, -ring.y, z], offset);
      offset += 6;
    }
  }
  for (let j = 0; j < equator; j++) {
    const angle = 2 * Math.PI * j / equator;
    points.set([Math.cos(angle), 0, Math.sin(angle)], offset);
    offset += 3;
  }
  return { points, minimumChord };
}

export function createInitialState(input = {}) {
  const config = cleanConfig(input);
  const { count, packing, distribution, seed } = config;
  const radius = PARTICLE_RADIUS;
  const positions = new Float64Array(count * 3), velocities = new Float64Array(count * 3);
  const random = randomGenerator(seed), diameter = CLOUD_REFERENCE_RADIUS * 2;
  const minimumSeparation = 2 * radius * (1 + 1e-8);
  // The distribution's extent uses a fixed reference radius.
  let scale = CLOUD_REFERENCE_RADIUS * Math.cbrt(count / packing);
  const mass = PARTICLE_MASS;
  const symmetricShell = distribution === 'symmetric-shell' ? symmetricShellPoints(count) : null;
  if (symmetricShell) {
    // Scaling preserves every ring's symmetry. Its analytic minimum chord
    // prevents overlap without randomising or discarding deterministic points.
    scale = Math.max(scale, minimumSeparation * (1 + 1e-8) / symmetricShell.minimumChord);
  }
  if (distribution === 'ring') {
    // A one-dimensional ring needs more space than a volume cloud. Its chord
    // length also has a hard lower bound to keep the equal-angle points apart.
    scale = Math.max(scale, CLOUD_REFERENCE_RADIUS * 1.05 / Math.sin(Math.PI / count)
      * Math.cbrt(DEFAULT_CONFIG.packing / packing),
      minimumSeparation * (1 + 1e-8) / (2 * Math.sin(Math.PI / count)));
  }
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
  function spherePoint(r) {
    const y = random() * 2 - 1, angle = random() * Math.PI * 2;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    return [r * horizontal * Math.cos(angle), r * y, r * horizontal * Math.sin(angle)];
  }
  function candidate(i) {
    if (symmetricShell) {
      const p = i * 3;
      return [symmetricShell.points[p] * scale, symmetricShell.points[p + 1] * scale, symmetricShell.points[p + 2] * scale];
    }
    if (distribution === 'ring') {
      const angle = 2 * Math.PI * i / count;
      return [scale * Math.cos(angle), 0, scale * Math.sin(angle)];
    }
    if (distribution === 'shell') return spherePoint(scale);
    if (distribution === 'disk') {
      const r = scale * 1.4 * Math.sqrt(random()), angle = random() * Math.PI * 2;
      const thickness = Math.max(diameter * 3, scale * .12);
      return [r * Math.cos(angle), (random() - .5) * thickness, r * Math.sin(angle)];
    }
    return spherePoint(scale * Math.cbrt(random()));
  }
  // Reject overlapping candidates before assigning velocities. Only accepted
  // centres enter the spatial hash.
  const cells = new Map(), minimumSeparation2 = minimumSeparation ** 2;
  const cellKey = (x, y, z) => `${x},${y},${z}`;
  function overlaps(point, cx, cy, cz) {
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const neighbours = cells.get(cellKey(cx + dx, cy + dy, cz + dz));
      if (!neighbours) continue;
      for (const i of neighbours) {
        const p = i * 3;
        const x = point[0] - positions[p], y = point[1] - positions[p + 1], z = point[2] - positions[p + 2];
        if (x * x + y * y + z * z < minimumSeparation2) return true;
      }
    }
    return false;
  }
  for (let i = 0; i < count; i++) {
    let accepted = false;
    for (let attempt = 0; attempt < 10000; attempt++) {
      const point = candidate(i);
      const cx = Math.floor(point[0] / minimumSeparation), cy = Math.floor(point[1] / minimumSeparation), cz = Math.floor(point[2] / minimumSeparation);
      if (overlaps(point, cx, cy, cz)) continue;
      positions.set(point, i * 3);
      const key = cellKey(cx, cy, cz), cell = cells.get(key) ?? [];
      cell.push(i); cells.set(key, cell);
      accepted = true;
      break;
    }
    if (!accepted) throw new Error('无法在当前紧密度下生成无重叠初始分布，请降低初始紧密度或小球数量。');
  }
  let sx = 0, sy = 0, sz = 0;
  for (let p = 0; p < positions.length; p += 3) { sx += positions[p]; sy += positions[p + 1]; sz += positions[p + 2]; }
  // Keep shell/ring centres on their requested surface. Coherent rotation uses
  // the sample's centre of mass so it adds no net translational velocity.
  const keepSurface = distribution === 'ring' || distribution === 'shell' || distribution === 'symmetric-shell';
  const centerX = keepSurface ? sx / count : 0, centerZ = keepSurface ? sz / count : 0;
  for (let p = 0; p < positions.length; p += 3) {
    if (!keepSurface) {
      positions[p] -= sx / count; positions[p + 1] -= sy / count; positions[p + 2] -= sz / count;
    }
  }
  if (config.virial === 0) return { config, positions, velocities, mass, radius, count, scale };
  for (let p = 0; p < positions.length; p += 3) {
    // Velocity distribution is independent of the selected position distribution.
    velocities[p] = gaussian(); velocities[p + 1] = gaussian(); velocities[p + 2] = gaussian();
  }
  let vx = 0, vy = 0, vz = 0;
  for (let p = 0; p < velocities.length; p += 3) { vx += velocities[p]; vy += velocities[p + 1]; vz += velocities[p + 2]; }
  for (let p = 0; p < velocities.length; p += 3) { velocities[p] -= vx / count; velocities[p + 1] -= vy / count; velocities[p + 2] -= vz / count; }
  const referencePotential = potentialEnergy(positions, count, INITIAL_MOTION_REFERENCE_G, mass,
    config.collisionless ? config.softeningRatio * radius : 0);
  // Preserve the existing removal of coherent rotation around the Y axis,
  // then assign the requested kinetic energy using reference G = 1.
  let rotation2 = 0, projection = 0;
  for (let p = 0; p < positions.length; p += 3) {
    const rx = positions[p + 2] - centerZ, rz = -(positions[p] - centerX);
    rotation2 += rx * rx + rz * rz;
    projection += velocities[p] * rx + velocities[p + 2] * rz;
  }
  const coefficient = rotation2 ? projection / rotation2 : 0;
  let thermal2 = 0;
  for (let p = 0; p < positions.length; p += 3) {
    velocities[p] -= coefficient * (positions[p + 2] - centerZ); velocities[p + 2] += coefficient * (positions[p] - centerX);
    thermal2 += velocities[p] ** 2 + velocities[p + 1] ** 2 + velocities[p + 2] ** 2;
  }
  const totalV2 = config.virial * Math.abs(referencePotential) / mass;
  const thermalScale = thermal2 ? Math.sqrt(totalV2 / thermal2) : 0;
  for (let p = 0; p < velocities.length; p += 3) {
    velocities[p] = velocities[p] * thermalScale;
    velocities[p + 1] *= thermalScale;
    velocities[p + 2] = velocities[p + 2] * thermalScale;
  }
  return { config, positions, velocities, mass, radius, count, scale };
}


function requireFinite(values, label) {
  for (const value of values) if (!Number.isFinite(value)) throw new Error(`${label}包含非有限数，已暂停。`);
}

export function stateBounds(positions, count, particleRadius = PARTICLE_RADIUS) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], center = [0, 0, 0];
  for (let p = 0; p < positions.length; p += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], positions[p + k]); max[k] = Math.max(max[k], positions[p + k]);
    center[k] += positions[p + k] / count;
  }
  let radius = particleRadius;
  for (let p = 0; p < positions.length; p += 3) {
    radius = Math.max(radius, Math.hypot(positions[p] - center[0], positions[p + 1] - center[1], positions[p + 2] - center[2]) + particleRadius);
  }
  return { min, max, center, radius };
}

/** CPU reference engine. Public arrays always describe a complete committed step. */
export class Simulation {
  constructor(config = {}) { this.initialize(config); }

  get softeningLength() { return this.config.collisionless ? this.config.softeningRatio * this.radius : 0; }

  initialize(config = {}) {
    const initial = createInitialState(config);
    this.config = initial.config;
    this.count = initial.count; this.radius = initial.radius; this.mass = initial.mass;
    this.initialScale = initial.scale;
    this.positions = initial.positions; this.velocities = initial.velocities;
    this.accelerations = new Float64Array(this.count * 3);
    this.acceptedSteps = 0; this.time = 0; this.collisions = 0; this.collisionEnergyLoss = 0;
    this._allocateScratch();
    return this;
  }

  _allocateScratch() {
    const size = this.count * 3;
    this._spare = { positions: new Float64Array(size), velocities: new Float64Array(size), accelerations: new Float64Array(size) };
    this._collisionWorkspace = this.config.collisionless ? null : createCollisionWorkspace(this.count);
    this._trial = null; this._forceReady = false;
    this.status = 'ready'; this.detail = ''; this.stepMs = 0;
  }

  /** Restore exactly the checkpoint velocities; this never regenerates or normalises. */
  restoreCheckpoint(snapshot, config = snapshot.config) {
    if (!snapshot?.positions || !snapshot?.velocities || snapshot.positions.length !== snapshot.velocities.length || snapshot.positions.length % 3) {
      throw new Error('恢复快照的粒子位置和速度无效。');
    }
    const count = snapshot.positions.length / 3;
    if (!Number.isInteger(count) || count < MIN_PARTICLES || count > MAX_PARTICLES) throw new Error('恢复快照的粒子数量无效。');
    const positions = Float64Array.from(snapshot.positions), velocities = Float64Array.from(snapshot.velocities);
    requireFinite(positions, '恢复位置'); requireFinite(velocities, '恢复速度');
    const acceptedSteps = Number(snapshot.acceptedSteps ?? 0), collisions = Number(snapshot.collisions ?? 0);
    const loss = Number(snapshot.collisionEnergyLoss ?? 0);
    if (!Number.isSafeInteger(acceptedSteps) || acceptedSteps < 0 || !Number.isSafeInteger(collisions) || collisions < 0 || !Number.isFinite(loss) || loss < 0) {
      throw new Error('恢复快照的累计计数无效。');
    }
    this.config = cleanConfig({ ...config, count });
    this.count = count; this.radius = PARTICLE_RADIUS; this.mass = PARTICLE_MASS;
    this.positions = positions; this.velocities = velocities; this.accelerations = new Float64Array(count * 3);
    this.acceptedSteps = acceptedSteps; this.time = acceptedSteps * FIXED_TIMESTEP;
    this.collisions = collisions; this.collisionEnergyLoss = loss;
    this._allocateScratch();
    return this;
  }

  static restore(snapshot, config = snapshot.config) {
    return Object.create(Simulation.prototype).restoreCheckpoint(snapshot, config);
  }

  _beginStep() {
    if (!this._forceReady) {
      directForces(this.positions, this.count, this.config.G * this.mass, this.accelerations, this.softeningLength);
      requireFinite(this.accelerations, '引力');
      this._forceReady = true;
    }
    const state = this._spare;
    state.positions.set(this.positions);
    for (let p = 0; p < this.velocities.length; p++) state.velocities[p] = this.velocities[p] + this.accelerations[p] * (FIXED_TIMESTEP * .5);
    requireFinite(state.velocities, '速度');
    this._trial = { ...state, phase: 'drift', drift: null, events: 0, dissipation: 0 };
    if (this.config.collisionless) {
      for (let p = 0; p < state.positions.length; p++) state.positions[p] += state.velocities[p] * FIXED_TIMESTEP;
      this._trial.phase = 'force';
    } else {
      this._trial.drift = createContinuousDrift(state.positions, state.velocities, this.count, this.radius, FIXED_TIMESTEP, {
        restitution: this.config.restitution, workspace: this._collisionWorkspace,
      });
    }
  }

  _commitStep() {
    const trial = this._trial;
    directForces(trial.positions, this.count, this.config.G * this.mass, trial.accelerations, this.softeningLength);
    for (let p = 0; p < trial.velocities.length; p++) trial.velocities[p] += trial.accelerations[p] * (FIXED_TIMESTEP * .5);
    requireFinite(trial.positions, '位置'); requireFinite(trial.velocities, '速度'); requireFinite(trial.accelerations, '引力');
    const steps = this.acceptedSteps + 1, collisions = this.collisions + trial.events;
    const loss = this.collisionEnergyLoss + this.mass * trial.dissipation;
    if (!Number.isSafeInteger(steps) || !Number.isSafeInteger(collisions) || !Number.isFinite(loss)) throw new Error('累计数值超出分辨率，已暂停。');
    this._spare = { positions: this.positions, velocities: this.velocities, accelerations: this.accelerations };
    this.positions = trial.positions; this.velocities = trial.velocities; this.accelerations = trial.accelerations;
    this.acceptedSteps = steps; this.time = steps * FIXED_TIMESTEP;
    this.collisions = collisions; this.collisionEnergyLoss = loss;
    this._trial = null;
  }

  /** The pending CCD trial counts toward `steps`; soft budgets never shorten dt. */
  advanceSteps(steps = 1, budgetMs = 8) {
    if (!Number.isSafeInteger(steps) || steps < 0) throw new Error('推进步数必须是非负整数。');
    if (!(budgetMs > 0)) return { advancedSteps: 0, advanced: 0, pending: Boolean(this._trial), ...this.metadata() };
    const before = this.acceptedSteps, started = now(), deadline = started + budgetMs;
    if (this.status === 'stopped') return { advancedSteps: 0, advanced: 0, pending: false, ...this.metadata() };
    while (this.acceptedSteps - before < steps && now() < deadline) {
      try {
        this.status = 'running';
        if (!this._trial) this._beginStep();
        const trial = this._trial;
        if (trial.phase === 'drift') {
          const drift = continueContinuousDrift(trial.drift, deadline);
          if (!drift.done) break;
          if (!drift.ok) throw new Error(drift.reason || '接触求解失败，已回滚完整时间步。');
          trial.events = drift.events; trial.dissipation = drift.dissipation; trial.phase = 'force';
        }
        // The pending complete drift can wait for the next wall-clock budget.
        if (now() >= deadline) break;
        this._commitStep();
      } catch (error) {
        // Only trial arrays were changed. p/v/a and all accounting stay atomic.
        this._trial = null;
        this.status = 'stopped'; this.detail = error.message || String(error);
        break;
      }
    }
    const advancedSteps = this.acceptedSteps - before;
    this.stepMs = now() - started;
    return { advancedSteps, advanced: advancedSteps * FIXED_TIMESTEP, pending: Boolean(this._trial), computeMs: this.stepMs, ...this.metadata() };
  }

  metadata() {
    return { count: this.count, radius: this.radius, mass: this.mass, acceptedSteps: this.acceptedSteps,
      time: this.time, collisions: this.collisions, collisionEnergyLoss: this.collisionEnergyLoss,
      status: this.status, detail: this.detail, stepMs: this.stepMs, precision: 'f64' };
  }

  bounds() { return stateBounds(this.positions, this.count, this.radius); }

  snapshot({ sampleCount = 24 } = {}) {
    const samples = Math.min(this.count, Math.max(0, Math.floor(sampleCount)));
    const sampleIndices = Uint32Array.from({ length: samples }, (_, i) => Math.floor(i * this.count / samples));
    const accelerations = this._forceReady ? new Float64Array(samples * 3) : undefined;
    if (accelerations) for (let i = 0; i < samples; i++) accelerations.set(this.accelerations.subarray(sampleIndices[i] * 3, sampleIndices[i] * 3 + 3), i * 3);
    return { ...this.metadata(), config: { ...this.config }, positions: this.positions.slice(), velocities: this.velocities.slice(),
      accelerations, sampleIndices, bounds: this.bounds() };
  }
}

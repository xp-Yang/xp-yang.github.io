import { computeForces, createForceWorkspace, potentialEnergy, sampleForceError } from './forces.js';
import { continuousDrift, createCollisionWorkspace, resolveInitialOverlaps } from './collisions.js';

export { computeForces, directForces, buildOctree } from './forces.js';

const SPHERE_RADIUS = .25;

export const DEFAULT_CONFIG = Object.freeze({
  count: 384, radius: SPHERE_RADIUS, density: 1, packing: .025, virial: 0,
  rotation: 0, distribution: 'uniform', seed: 42, G: 1, restitution: 1,
  theta: .55, maxDt: .016, travelFraction: .2,
});

const now = () => globalThis.performance?.now() ?? Date.now();
const clamp = (x, min, max) => Math.max(min, Math.min(max, Number(x)));
const DISTRIBUTIONS = ['uniform', 'gaussian', 'disk', 'ring', 'shell', 'symmetric-shell', 'binary'];
const CLOUD_REFERENCE_RADIUS = .45;

function cleanConfig(input) {
  const c = { ...DEFAULT_CONFIG, ...input };
  for (const key of Object.keys(DEFAULT_CONFIG)) if (typeof DEFAULT_CONFIG[key] === 'number' && !Number.isFinite(Number(c[key]))) throw new Error(`Invalid simulation parameter: ${key}`);
  c.count = Math.round(clamp(c.count, 2, 1000));
  c.radius = SPHERE_RADIUS;
  delete c.collisions;
  c.restitution = clamp(c.restitution, 0, 1);
  c.density = clamp(c.density, .001, 100);
  c.packing = clamp(c.packing, .001, .18);
  c.virial = clamp(c.virial, 0, 5);
  c.rotation = clamp(c.rotation, 0, 1);
  c.G = clamp(c.G, 0, 100);
  c.theta = clamp(c.theta, 0, 1.2);
  c.maxDt = clamp(c.maxDt, .00001, .1);
  c.travelFraction = clamp(c.travelFraction, .01, .4);
  c.seed = Number(c.seed) >>> 0;
  if (!DISTRIBUTIONS.includes(c.distribution)) c.distribution = 'uniform';
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

function initialise(config) {
  const { count, radius, packing, distribution, seed, rotation } = config;
  const positions = new Float64Array(count * 3), velocities = new Float64Array(count * 3);
  const random = randomGenerator(seed), diameter = CLOUD_REFERENCE_RADIUS * 2;
  const minimumSeparation = 2 * radius * (1 + 1e-8);
  // The distribution's extent uses a fixed reference radius.
  let scale = CLOUD_REFERENCE_RADIUS * Math.cbrt(count / packing);
  const mass = config.density * 4 * Math.PI * radius ** 3 / 3;
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
    if (distribution === 'gaussian') {
      let p;
      do { p = [gaussian() * scale * .46, gaussian() * scale * .46, gaussian() * scale * .46]; } while (Math.hypot(...p) > scale * 2);
      return p;
    }
    if (distribution === 'disk') {
      const r = scale * 1.4 * Math.sqrt(random()), angle = random() * Math.PI * 2;
      const thickness = Math.max(diameter * 3, scale * .12);
      return [r * Math.cos(angle), (random() - .5) * thickness, r * Math.sin(angle)];
    }
    if (distribution === 'binary') {
      const p = spherePoint(scale * .72 * Math.cbrt(random()));
      p[0] += i < count / 2 ? -scale * .9 : scale * .9;
      return p;
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
  if (config.virial === 0) return { positions, velocities, mass, scale };
  for (let p = 0; p < positions.length; p += 3) {
    // Velocity distribution is independent of the selected position distribution.
    velocities[p] = gaussian(); velocities[p + 1] = gaussian(); velocities[p + 2] = gaussian();
  }
  let vx = 0, vy = 0, vz = 0;
  for (let p = 0; p < velocities.length; p += 3) { vx += velocities[p]; vy += velocities[p + 1]; vz += velocities[p + 2]; }
  for (let p = 0; p < velocities.length; p += 3) { velocities[p] -= vx / count; velocities[p + 1] -= vy / count; velocities[p + 2] -= vz / count; }
  const potential = potentialEnergy(positions, count, config.G, mass);
  // Orthogonalise thermal motion to the coherent rotation, then allocate the
  // requested total kinetic energy: rotation is an actual energy fraction.
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
  const totalV2 = config.virial * Math.abs(potential) / mass;
  const thermalScale = thermal2 ? Math.sqrt((1 - rotation) * totalV2 / thermal2) : 0;
  const rotationScale = rotation2 ? Math.sqrt(rotation * totalV2 / rotation2) : 0;
  for (let p = 0; p < velocities.length; p += 3) {
    velocities[p] = velocities[p] * thermalScale + (positions[p + 2] - centerZ) * rotationScale;
    velocities[p + 1] *= thermalScale;
    velocities[p + 2] = velocities[p + 2] * thermalScale - (positions[p] - centerX) * rotationScale;
  }
  return { positions, velocities, mass, scale };
}

export class Simulation {
  constructor(config = {}) { this.reset(config); }

  reset(config = {}) {
    const nextConfig = cleanConfig({ ...this.config, ...config });
    const initial = initialise(nextConfig);
    this.config = nextConfig;
    this.count = this.config.count;
    this.radius = this.config.radius;
    this.mass = initial.mass;
    this.positions = initial.positions;
    this.velocities = initial.velocities;
    this.initialScale = initial.scale;
    this.accelerations = new Float64Array(this.count * 3);
    this._backupPositions = new Float64Array(this.count * 3);
    this._backupVelocities = new Float64Array(this.count * 3);
    this._forceWorkspace ??= createForceWorkspace(this.count);
    this._collisionWorkspace ??= createCollisionWorkspace(this.count);
    this.time = 0; this.collisions = 0; this.acceptedSteps = 0;
    this.stepMs = 0; this.status = 'ready'; this.detail = '';
    this.ccdStatus = '等待初始接触处理'; this.retries = 0;
    this._initialContactsPending = true;
    this._normaliseInitialMotion = true;
    this._baseline = null;
    this._collisionEnergyLoss = 0;
    this._diagnosticStamp = -Infinity;
    this._lastForceEvaluator = null;
    this.forcePrecision = 'f64';
    return this;
  }

  configure(changes = {}) {
    const runtime = {};
    for (const key of ['G', 'density', 'restitution', 'theta', 'maxDt', 'travelFraction']) if (key in changes) runtime[key] = changes[key];
    const previous = this.config;
    this.config = cleanConfig({ ...this.config, ...runtime });
    this.mass = this.config.density * 4 * Math.PI * this.radius ** 3 / 3;
    if (this._initialContactsPending && this._normaliseInitialMotion && this.status !== 'stopped'
      && previous.G !== this.config.G) {
      // Preserve generated motion when gravity is enabled before the first
      // advance; a G = 0 initialisation otherwise has no velocity directions.
      this.velocities.set(initialise(this.config).velocities);
    }
    if (!this._initialContactsPending) {
      if (previous.G !== this.config.G || previous.density !== this.config.density
        || previous.theta !== this.config.theta) this._computeForces();
      if (previous.G !== this.config.G || previous.density !== this.config.density) this._setBaseline();
    }
    this._diagnosticStamp = -Infinity;
    if (this.status === 'stopped' && !this._initialContactsPending) { this.status = 'ready'; this.detail = ''; }
    return this;
  }

  /** Import API: finite positions; overlaps resolve before the first advance. */
  setState(positions, velocities) {
    if (positions.length !== velocities.length || positions.length % 3 || positions.length < 6) throw new Error('State must contain matching xyz positions and velocities for at least two spheres.');
    const p = Float64Array.from(positions), v = Float64Array.from(velocities);
    for (const x of [...p, ...v]) if (!Number.isFinite(x)) throw new Error('State contains a non-finite number.');
    const count = p.length / 3;
    this.positions = p; this.velocities = v; this.count = count;
    this.config.count = count;
    this.accelerations = new Float64Array(p.length);
    this._backupPositions = new Float64Array(p.length); this._backupVelocities = new Float64Array(p.length);
    this.time = 0; this.collisions = 0; this.acceptedSteps = 0; this.retries = 0;
    this.stepMs = 0; this.status = 'ready'; this.detail = '';
    this.ccdStatus = '等待初始接触处理';
    this._initialContactsPending = true;
    this._normaliseInitialMotion = false;
    this._baseline = null;
    this._collisionEnergyLoss = 0;
    this._diagnosticStamp = -Infinity;
    this._lastForceEvaluator = null;
    this.forcePrecision = 'f64';
    return this;
  }

  _prepareInitialContacts() {
    const contact = resolveInitialOverlaps(this.positions, this.velocities, this.count, this.radius, { restitution: this.config.restitution });
    this.collisions += contact.events;
    if (!contact.ok) {
      this.status = 'stopped';
      this.detail = contact.reason;
      this.ccdStatus = '初始接触处理暂停';
      return false;
    }
    // Removing penetration changes potential energy. Normalise generated
    // initial motion before establishing the baseline; imported velocities
    // receive only the contact impulses and are never rescaled.
    if (this._normaliseInitialMotion) {
      const kinetic = this._kineticAndMomentum().kinetic;
      const potential = potentialEnergy(this.positions, this.count, this.config.G, this.mass);
      const targetKinetic = this.config.virial * Math.abs(potential) * .5;
      const factor = kinetic > 0 ? Math.sqrt(targetKinetic / kinetic) : 0;
      for (let p = 0; p < this.velocities.length; p++) this.velocities[p] *= factor;
    }
    this._initialContactsPending = false;
    this.ccdStatus = contact.separatedPairs ? '初始重叠已处理' : '连续碰撞检测';
    return true;
  }

  _computeForces() {
    computeForces(this.positions, this.count, this.config.G * this.mass, this.config.theta, this.accelerations, this._forceWorkspace);
    this._lastForceEvaluator = null;
    this.forcePrecision = 'f64';
  }

  _kineticAndMomentum() {
    let kinetic = 0, px = 0, py = 0, pz = 0, scale = 0;
    for (let p = 0; p < this.velocities.length; p += 3) {
      const x = this.velocities[p], y = this.velocities[p + 1], z = this.velocities[p + 2];
      kinetic += .5 * this.mass * (x * x + y * y + z * z);
      px += this.mass * x; py += this.mass * y; pz += this.mass * z;
      scale += this.mass * Math.hypot(x, y, z);
    }
    return { kinetic, momentum: [px, py, pz], momentumScale: scale };
  }

  _setBaseline() {
    this._collisionEnergyLoss = 0;
    const motion = this._kineticAndMomentum();
    const potential = potentialEnergy(this.positions, this.count, this.config.G, this.mass);
    // Unsoftened point gravity has no finite potential at an exactly coincident
    // centre. Keep that diagnostic unavailable instead of inventing an energy.
    const energy = Number.isFinite(potential) ? motion.kinetic + potential : null;
    this._baseline = { energy, scale: energy === null ? null : Math.max(motion.kinetic + Math.abs(potential), 1e-20), momentum: motion.momentum, momentumScale: Math.max(motion.momentumScale, this.mass, 1e-20) };
    this._diagnosticStamp = -Infinity;
    this._diagnostics = { kinetic: motion.kinetic, potential: Number.isFinite(potential) ? potential : null, energy, energyDrift: energy === null ? null : 0, momentumError: 0, forceError: 0 };
  }

  _safeStep() {
    let vmax2 = 0, amax2 = 0;
    for (let p = 0; p < this.positions.length; p += 3) {
      const vx = this.velocities[p], vy = this.velocities[p + 1], vz = this.velocities[p + 2];
      const ax = this.accelerations[p], ay = this.accelerations[p + 1], az = this.accelerations[p + 2];
      vmax2 = Math.max(vmax2, vx * vx + vy * vy + vz * vz);
      amax2 = Math.max(amax2, ax * ax + ay * ay + az * az);
    }
    // Preserve hypot's range for large but finite states imported through API.
    let vmax = Math.sqrt(vmax2), amax = Math.sqrt(amax2);
    if (!Number.isFinite(vmax2) || !Number.isFinite(amax2)) {
      vmax = amax = 0;
      for (let p = 0; p < this.positions.length; p += 3) {
        vmax = Math.max(vmax, Math.hypot(this.velocities[p], this.velocities[p + 1], this.velocities[p + 2]));
        amax = Math.max(amax, Math.hypot(this.accelerations[p], this.accelerations[p + 1], this.accelerations[p + 2]));
      }
    }
    const travel = this.config.travelFraction * this.radius * 2;
    return Math.min(this.config.maxDt, travel / Math.max(2 * vmax, 1e-20), Math.sqrt(travel / Math.max(2 * amax, 1e-20)));
  }

  advance(targetDuration, budgetMs = 12) {
    const steps = this._advance(targetDuration, budgetMs, null);
    let result = steps.next();
    while (!result.done) {
      try { this._computeForces(); }
      catch (error) { steps.throw(error); throw error; }
      result = steps.next();
    }
    return result.value;
  }

  /** Async force evaluation shares the same atomic KDK/CCD steps as CPU. */
  async advanceAsync(targetDuration, budgetMs = 12, evaluateForces = null) {
    if (!evaluateForces) return this.advance(targetDuration, budgetMs);
    const steps = this._advance(targetDuration, budgetMs, evaluateForces);
    let result = steps.next();
    while (!result.done) {
      try { await evaluateForces(this); }
      catch (error) { steps.throw(error); throw error; }
      result = steps.next();
    }
    return result.value;
  }

  *_advance(targetDuration, budgetMs, evaluateForces) {
    if (!Number.isFinite(targetDuration) || targetDuration <= 0 || this.status === 'stopped') return 0;
    const start = now(), before = this.time;
    const preparing = this._initialContactsPending;
    if (preparing && !this._prepareInitialContacts()) return 0;
    if (preparing || this._lastForceEvaluator !== evaluateForces) {
      try { yield; }
      catch (error) {
        if (preparing) this._initialContactsPending = true;
        this.status = 'stopped'; this.ccdStatus = '求力暂停';
        this.detail = error.message || String(error);
        throw error;
      }
      this._lastForceEvaluator = evaluateForces;
    }
    if (preparing) this._setBaseline();
    const gm = this.config.G * this.mass;
    const contactScale = gm ? Math.sqrt((2 * this.radius) ** 3 / gm) : Infinity;
    const contactDt = gm ? Math.min(this.config.maxDt / 32, contactScale * .00075) : Infinity;
    let remaining = targetDuration;
    this.status = 'running';
    while (remaining > 1e-12 && (now() - start < budgetMs || this.time === before)) {
      let dt = Math.min(remaining, this._safeStep());
      if (!Number.isFinite(dt) || dt <= 0 || this.time + dt === this.time) {
        this.status = 'stopped'; this.detail = '物理步长低于数值分辨率，已安全暂停。';
        this.ccdStatus = '时间步无法推进'; break;
      }
      const stepStart = now();
      this._backupPositions.set(this.positions); this._backupVelocities.set(this.velocities);
      let success = false;
      for (let retry = 0; retry < 12; retry++) {
        if (retry) { this.positions.set(this._backupPositions); this.velocities.set(this._backupVelocities); }
        for (let p = 0; p < this.velocities.length; p++) this.velocities[p] += this.accelerations[p] * dt * .5;
        const drift = continuousDrift(this.positions, this.velocities, this.count, this.radius, dt, {
          restitution: this.config.restitution, maxMs: 40, contactDt, workspace: this._collisionWorkspace,
        });
        if (drift.refine) {
          this.retries++; this.ccdStatus = '碰撞前自适应细分';
          // Aim at the predicted boundary rather than repeatedly taking 80%
          // of the approach. The changed half-kick invalidates the old TOI, so
          // the next trial still performs complete CCD before accepting it.
          dt = Math.max(contactDt, Math.min(dt * .5, drift.firstImpactTime));
          continue;
        }
        if (drift.ok) {
          // Force splitting is less accurate at an impulsive contact than on a
          // smooth orbit. Approach predicted contacts with shorter atomic steps;
          // a rejected trial is rolled back, including all its collision events.
          try {
            yield;
            this._lastForceEvaluator = evaluateForces;
          } catch (error) {
            // No time, impulse count or dissipation has been committed yet.
            this.positions.set(this._backupPositions); this.velocities.set(this._backupVelocities);
            this.status = 'stopped'; this.ccdStatus = '求力暂停';
            this.detail = error.message || String(error);
            throw error;
          }
          for (let p = 0; p < this.velocities.length; p++) this.velocities[p] += this.accelerations[p] * dt * .5;
          this.collisions += drift.events;
          this._collisionEnergyLoss += this.mass * drift.dissipation;
          this.time += dt; this.acceptedSteps++;
          this.ccdStatus = retry ? '连续碰撞 · 已细分时间步' : '连续碰撞检测';
          success = true; break;
        }
        this.retries++; this.ccdStatus = drift.reason; dt *= .5;
        if (dt < 1e-9) break;
      }
      if (!success) {
        this.positions.set(this._backupPositions); this.velocities.set(this._backupVelocities);
        this.status = 'stopped'; this.detail = '密集接触求解达到预算，已安全暂停；请降低紧密度或提高时间精度。';
        this.ccdStatus = '接触求解暂停'; break;
      }
      const measured = now() - stepStart;
      this.stepMs = this.stepMs ? this.stepMs * .8 + measured * .2 : measured;
      remaining = Math.max(0, targetDuration - (this.time - before));
    }
    return this.time - before;
  }

  bounds() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], center = [0, 0, 0];
    for (let p = 0; p < this.positions.length; p += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], this.positions[p + k]); max[k] = Math.max(max[k], this.positions[p + k]); center[k] += this.positions[p + k] / this.count;
    }
    let radius = this.radius;
    for (let p = 0; p < this.positions.length; p += 3) radius = Math.max(radius, Math.hypot(this.positions[p] - center[0], this.positions[p + 1] - center[1], this.positions[p + 2] - center[2]) + this.radius);
    return { min, max, center, radius };
  }

  stats(forceRefresh = false) {
    if (this._initialContactsPending || !this._baseline) {
      this._diagnostics = { kinetic: this._kineticAndMomentum().kinetic, potential: null, energy: null, energyDrift: null, momentumError: null, forceError: null };
    } else if (forceRefresh || now() - this._diagnosticStamp > 750) {
      const motion = this._kineticAndMomentum();
      const potential = potentialEnergy(this.positions, this.count, this.config.G, this.mass);
      const energy = Number.isFinite(potential) ? motion.kinetic + potential : null;
      const momentumError = Math.hypot(...motion.momentum.map((x, k) => x - this._baseline.momentum[k])) / this._baseline.momentumScale;
      this._diagnostics = { kinetic: motion.kinetic, potential: Number.isFinite(potential) ? potential : null, energy, energyDrift: energy !== null && this._baseline.energy !== null ? (energy + this._collisionEnergyLoss - this._baseline.energy) / this._baseline.scale : null, momentumError, forceError: sampleForceError(this.positions, this.count, this.config.G * this.mass, this.config.theta, this.accelerations, 24, this.forcePrecision === 'f32') };
      this._diagnosticStamp = now();
    }
    return { ...this._diagnostics, initialContactsPending: this._initialContactsPending, bounds: this.bounds(), stepMs: this.stepMs, acceptedSteps: this.acceptedSteps, collisions: this.collisions, time: this.time, count: this.count, mass: this.mass, radius: this.radius, status: this.status, detail: this.detail, ccdStatus: this.ccdStatus, retries: this.retries, diagnosticsTime: this._diagnosticStamp };
  }
}

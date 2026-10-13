// Both engines publish the same two-slot SoA state. The free engine never
// compiles or dispatches the CCD kernels below.
export function createPhysicsShader({ collisionless, tileSize = 256 }) {
  const ccd = collisionless ? '' : CCD_SHADER;
  return /* wgsl */ `
const INF: f32 = 3.402823466e38;
const EPS: f32 = 1.1920928955078125e-7;
const FREE: bool = ${collisionless};
const TILE: u32 = ${tileSize}u;
const READY: u32 = 0u;
const SEARCH: u32 = 1u;
const DRIFT: u32 = 2u;
const FINISH: u32 = 3u;
const UPDATE: u32 = 4u;

struct Parameters {
  count: u32, targetStep: u32, maxEvents: u32, groups: u32,
  gm: f32, dt: f32, softening2: f32, diameter: f32,
  restitution: f32, mass: f32, sampleCount: u32, fullCapture: u32,
  candidateCapacity: u32, padding0: u32, padding1: u32, padding2: u32,
}
// The first two words are part of the renderer contract. Remaining words are
// metadata, numerical guards, or private CCD progress; never CPU scheduling.
struct Control {
  activeIndex: u32, committedStep: u32, collisions: u32, status: u32,
  invalid: atomic<u32>, phase: u32, trialEvents: u32, oldCacheCount: u32,
  timeHi: f32, timeLo: f32, lossHi: f32, lossLo: f32,
  elapsedHi: f32, elapsedLo: f32, driftTime: f32, trialLossHi: f32,
  trialLossLo: f32, selectedI: u32, selectedJ: u32, fault: u32,
  cacheCount: atomic<u32>, cacheOverflow: atomic<u32>, cacheSlot: u32, cacheMode: u32,
  driftTimeLo: f32, padding0: u32, padding1: u32, padding2: u32,
}
@group(0) @binding(0) var<uniform> params: Parameters;
@group(0) @binding(1) var<storage, read_write> positionHi: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> positionLo: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> accelerations: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> control: Control;
@group(1) @binding(1) var<storage, read_write> capture: array<vec4<f32>>;

var<workgroup> tileHi: array<vec4<f32>, ${tileSize}>;
var<workgroup> tileLo: array<vec4<f32>, ${tileSize}>;
var<workgroup> forceNeeded: u32;
var<workgroup> minima3: array<vec3<f32>, 128>;
var<workgroup> maxima3: array<vec3<f32>, 128>;
var<workgroup> speeds: array<f32, 128>;

fn finite3(v: vec3<f32>) -> bool { return all(abs(v) <= vec3<f32>(INF)); }
fn maximum(v: vec3<f32>) -> f32 { let a = abs(v); return max(a.x, max(a.y, a.z)); }
fn two_sum(a: f32, b: f32) -> vec2<f32> {
  let s = a + b; let z = s - a;
  return vec2<f32>(s, (a - (s - z)) + (b - z));
}
fn add_compensated(hi: f32, lo: f32, value: f32) -> vec2<f32> {
  let sum = two_sum(hi, value);
  return two_sum(sum.x, sum.y + lo);
}
fn add_position(index: u32, delta: vec3<f32>, residual: vec3<f32>) {
  let old = positionHi[index].xyz;
  let sum = old + delta;
  let recovered = sum - old;
  let error = (old - (sum - recovered)) + (delta - recovered)
    + positionLo[index].xyz + residual;
  let next = sum + error;
  positionHi[index] = vec4<f32>(next, 0.0);
  positionLo[index] = vec4<f32>(error - (next - sum), 0.0);
}
fn move_particle(index: u32, dt: f32) {
  let v = velocities[index].xyz;
  let distance = v * dt;
  add_position(index, distance, fma(v, vec3<f32>(dt), -distance));
}
fn validate_body(index: u32) {
  let hi = positionHi[index].xyz; let lo = positionLo[index].xyz;
  let scale = select(params.diameter, sqrt(params.softening2), FREE);
  // Hi/lo carries an extra mantissa. Guard its effective resolution rather
  // than rejecting a small high-word ULP that the low word already preserves.
  let resolution = maximum(hi) * (EPS * EPS * 8.0) + maximum(lo) * EPS;
  if (!finite3(hi) || !finite3(lo) || !finite3(velocities[index].xyz)
      || !finite3(accelerations[index].xyz) || resolution > scale * 0.001) {
    atomicOr(&control.invalid, 1u);
  }
}

@compute @workgroup_size(${tileSize})
fn kick_drift(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.count || control.status != 0u || control.committedStep >= params.targetStep) { return; }
  let a = control.activeIndex * params.count + i;
  let b = (1u - control.activeIndex) * params.count + i;
  positionHi[b] = positionHi[a]; positionLo[b] = positionLo[a];
  velocities[b] = vec4<f32>(fma(accelerations[a].xyz, vec3<f32>(params.dt * 0.5), velocities[a].xyz), 0.0);
  move_particle(b, params.dt);
}

fn evaluate_force(i: u32, lane: u32, slot: u32, finalKick: bool) {
  let bodyActive = i < params.count;
  let destination = slot * params.count + i;
  var hi = vec3<f32>(0.0); var lo = vec3<f32>(0.0);
  if (bodyActive) { hi = positionHi[destination].xyz; lo = positionLo[destination].xyz; }
  var acceleration = vec3<f32>(0.0); var compensation = vec3<f32>(0.0);
  // Uniform branch: G=0 has no tiled loop, including on the initial upload.
  if (params.gm != 0.0) {
    for (var base = 0u; base < params.count; base += TILE) {
      let source = base + lane;
      tileHi[lane] = vec4<f32>(0.0); tileLo[lane] = vec4<f32>(0.0);
      if (source < params.count) {
        tileHi[lane] = positionHi[slot * params.count + source];
        tileLo[lane] = positionLo[slot * params.count + source];
      }
      workgroupBarrier();
      if (bodyActive) {
        let length = min(TILE, params.count - base);
        for (var k = 0u; k < length; k++) {
          if (base + k != i) {
            let delta = (tileHi[k].xyz - hi) + (tileLo[k].xyz - lo);
            let distance2 = dot(delta, delta) + params.softening2;
            if (!(distance2 > 0.0 && distance2 < INF)) { atomicOr(&control.invalid, 1u); }
            else {
              let magnitude = params.gm / distance2;
              if (magnitude == 0.0) { atomicOr(&control.invalid, 1u); }
              let contribution = delta * (1.0 / sqrt(distance2)) * magnitude;
              let corrected = contribution - compensation;
              let sum = acceleration + corrected;
              compensation = (sum - acceleration) - corrected;
              acceleration = sum;
            }
          }
        }
      }
      workgroupBarrier();
    }
  }
  if (bodyActive) {
    accelerations[destination] = vec4<f32>(acceleration, 0.0);
    if (finalKick) {
      velocities[destination] = vec4<f32>(fma(acceleration, vec3<f32>(params.dt * 0.5), velocities[destination].xyz), 0.0);
    }
    validate_body(destination);
  }
}

@compute @workgroup_size(${tileSize})
fn initial_force(@builtin(global_invocation_id) id: vec3<u32>, @builtin(local_invocation_index) lane: u32) {
  evaluate_force(id.x, lane, control.activeIndex, false);
}

@compute @workgroup_size(1)
fn validate_initial() {
  let fault = atomicLoad(&control.invalid);
  if (fault != 0u) { control.status = 1u; control.fault = fault; }
}

@compute @workgroup_size(${tileSize})
fn force_final_kick(@builtin(global_invocation_id) id: vec3<u32>, @builtin(local_invocation_index) lane: u32) {
  if (lane == 0u) {
    forceNeeded = select(0u, 1u, control.status == 0u && control.committedStep < params.targetStep
      && (FREE || control.phase == FINISH));
  }
  let needed = workgroupUniformLoad(&forceNeeded);
  if (needed == 0u) { return; }
  evaluate_force(id.x, lane, 1u - control.activeIndex, true);
}

@compute @workgroup_size(1)
fn commit() {
  if (control.status != 0u || control.committedStep >= params.targetStep || (!FREE && control.phase != FINISH)) { return; }
  let nextTime = add_compensated(control.timeHi, control.timeLo, params.dt);
  // Equal-mass collision loss is accumulated per unit mass. The host applies
  // the original f64 mass once when reporting it, avoiding repeated rounding.
  let increment = select(control.trialLossHi, 0.0, FREE);
  var nextLoss = add_compensated(control.lossHi, control.lossLo, increment);
  if (!FREE) { nextLoss = add_compensated(nextLoss.x, nextLoss.y, control.trialLossLo); }
  let events = select(control.trialEvents, 0u, FREE);
  if (control.committedStep == 0xffffffffu || control.collisions > 0xffffffffu - events
      || !(nextTime.x >= 0.0 && nextTime.x < INF && nextLoss.x >= 0.0 && nextLoss.x < INF)) {
    atomicOr(&control.invalid, 8u);
  }
  let fault = atomicLoad(&control.invalid);
  if (fault != 0u) { control.status = 1u; control.fault = fault; return; }
  control.activeIndex = 1u - control.activeIndex;
  control.committedStep += 1u; control.collisions += events;
  control.timeHi = nextTime.x; control.timeLo = nextTime.y;
  control.lossHi = nextLoss.x; control.lossLo = nextLoss.y;
  control.phase = READY;
}

// One group packs the active slot and computes bounds. No simulation buffer is
// mapped, and metadata is copied by the encoder at this same queue boundary.
@compute @workgroup_size(128)
fn capture_state(@builtin(local_invocation_index) lane: u32) {
  var lower = vec3<f32>(INF); var upper = vec3<f32>(-INF); var speed = 0.0;
  let offset = control.activeIndex * params.count;
  for (var i = lane; i < params.count; i += 128u) {
    let hi = positionHi[offset + i]; let lo = positionLo[offset + i];
    let velocity = velocities[offset + i];
    let extent = abs(lo.xyz) + abs(hi.xyz) * (2.0 * EPS);
    lower = min(lower, hi.xyz - extent); upper = max(upper, hi.xyz + extent);
    speed = max(speed, length(velocity.xyz));
    if (params.fullCapture != 0u) {
      capture[9u + i * 3u] = hi;
      capture[10u + i * 3u] = lo;
      capture[11u + i * 3u] = velocity;
    }
  }
  if (params.fullCapture != 0u && lane < params.sampleCount) {
    let particle = lane * params.count / params.sampleCount;
    capture[9u + 3u * params.count + lane] = accelerations[offset + particle];
  }
  minima3[lane] = lower; maxima3[lane] = upper; speeds[lane] = speed;
  workgroupBarrier();
  for (var stride = 64u; stride > 0u; stride /= 2u) {
    if (lane < stride) {
      minima3[lane] = min(minima3[lane], minima3[lane + stride]);
      maxima3[lane] = max(maxima3[lane], maxima3[lane + stride]);
      speeds[lane] = max(speeds[lane], speeds[lane + stride]);
    }
    workgroupBarrier();
  }
  if (lane == 0u) {
    capture[7] = vec4<f32>(minima3[0], speeds[0]);
    capture[8] = vec4<f32>(maxima3[0], f32(params.count));
  }
}
${ccd}
`;
}

const CCD_SHADER = /* wgsl */ `
// A two-word absolute time preserves the small TOI when adding it to elapsed
// time. Pair order is lexicographic (i,j), so a redundant pair ID is unnecessary.
struct Hit { time: f32, timeLo: f32, i: u32, j: u32, }
@group(1) @binding(0) var<storage, read_write> groupHits: array<Hit>;
@group(1) @binding(2) var<storage, read_write> candidateHits: array<Hit>;
var<workgroup> hits: array<Hit, 128>;

fn earlier(a: Hit, b: Hit) -> Hit {
  if (a.time < b.time || (a.time == b.time && a.timeLo < b.timeLo)) { return a; }
  if (a.time == b.time && a.timeLo == b.timeLo) { return lower_pair(a, b); }
  return b;
}
fn lower_pair(a: Hit, b: Hit) -> Hit {
  if (a.i < b.i || (a.i == b.i && a.j < b.j)) { return a; }
  return b;
}
fn inside_tie_window(hit: Hit) -> bool {
  let difference = (hit.time - control.driftTime) + (hit.timeLo - control.driftTimeLo);
  return hit.time < INF && difference <= 1e-12;
}
fn remaining_time() -> vec2<f32> {
  let high = two_sum(params.dt, -control.elapsedHi);
  return add_compensated(high.x, high.y, -control.elapsedLo);
}
fn accurate_dot(a: vec3<f32>, b: vec3<f32>) -> f32 {
  return fma(a.x, b.x, fma(a.y, b.y, a.z * b.z));
}
fn contact_tolerance(i: u32, j: u32, relative: vec3<f32>) -> f32 {
  let coordinate = max(maximum(positionHi[i].xyz), maximum(positionHi[j].xyz));
  return 4.0 * EPS * max(params.diameter, maximum(relative)) + coordinate * (8.0 * EPS * EPS);
}
fn velocity_tolerance(a: vec3<f32>, b: vec3<f32>) -> f32 {
  return 4.0 * EPS * max(maximum(a), maximum(b));
}
fn impact_time(i: u32, j: u32, duration: f32) -> f32 {
  let r = (positionHi[j].xyz - positionHi[i].xyz) + (positionLo[j].xyz - positionLo[i].xyz);
  let vi = velocities[i].xyz; let vj = velocities[j].xyz; let v = vj - vi;
  let tolerance = contact_tolerance(i, j, r);
  if (any(abs(r) > vec3<f32>(params.diameter + tolerance) + abs(v) * duration)) { return INF; }
  let rr = accurate_dot(r, r);
  if (!(rr >= 0.0 && rr < INF)) { return 0.0; }
  let distance = sqrt(rr);
  if (distance < params.diameter - tolerance) { return 0.0; }
  let b = accurate_dot(r, v);
  let closing = velocity_tolerance(vi, vj);
  if (!(b < -closing * distance)) { return INF; }
  let a = accurate_dot(v, v);
  if (!(a > 0.0 && a < INF)) { return INF; }
  if (distance <= params.diameter + tolerance) { return 0.0; }
  let c = fma(-params.diameter, params.diameter, rr);
  let discriminant = fma(-a, c, b * b);
  if (!(discriminant >= 0.0 && discriminant < INF)) { return INF; }
  let denominator = -b + sqrt(discriminant);
  if (!(denominator > 0.0)) { return INF; }
  let time = c / denominator;
  let timeTolerance = max(8.0 * EPS * max(duration, time), tolerance / sqrt(a));
  if (!(time >= 0.0) || time > duration + timeTolerance) { return INF; }
  let bounded = min(time, duration);
  if (!(fma(a, bounded, b) < -closing * params.diameter)) { return INF; }
  return bounded;
}

@compute @workgroup_size(128)
fn ccd_begin(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.count || control.status != 0u || control.phase != READY || control.committedStep >= params.targetStep) { return; }
  let a = control.activeIndex * params.count + i;
  let b = (1u - control.activeIndex) * params.count + i;
  positionHi[b] = positionHi[a]; positionLo[b] = positionLo[a];
  velocities[b] = vec4<f32>(fma(accelerations[a].xyz, vec3<f32>(params.dt * 0.5), velocities[a].xyz), 0.0);
  if (!finite3(velocities[b].xyz)) { atomicOr(&control.invalid, 1u); }
}
@compute @workgroup_size(1)
fn ccd_start() {
  if (control.status != 0u || control.phase != READY || control.committedStep >= params.targetStep) { return; }
  let fault = atomicLoad(&control.invalid);
  if (fault != 0u) { control.status = 1u; control.fault = fault; return; }
  control.elapsedHi = 0.0; control.elapsedLo = 0.0;
  control.trialEvents = 0u; control.trialLossHi = 0.0; control.trialLossLo = 0.0;
  control.driftTime = 0.0; control.driftTimeLo = 0.0; control.phase = SEARCH;
  atomicStore(&control.cacheCount, 0u); atomicStore(&control.cacheOverflow, 0u);
  control.cacheSlot = 0u; control.cacheMode = 0u;
}

fn append_candidate(hit: Hit) {
  if (hit.time == INF) { return; }
  let index = atomicAdd(&control.cacheCount, 1u);
  if (index < params.candidateCapacity) {
    candidateHits[control.cacheSlot * params.candidateCapacity + index] = hit;
  } else { atomicStore(&control.cacheOverflow, 1u); }
}

// A conservative all-pair TOI build keeps only contacts inside this fixed
// drift. Overflow switches the entire trial to streaming; it never truncates.
@compute @workgroup_size(128)
fn ccd_build_candidates(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.count || control.status != 0u || control.phase != SEARCH || control.cacheMode != 0u) { return; }
  let offset = (1u - control.activeIndex) * params.count;
  for (var j = i + 1u; j < params.count; j++) {
    let toi = impact_time(offset + i, offset + j, params.dt);
    append_candidate(Hit(toi, 0.0, i, j));
  }
}

@compute @workgroup_size(1)
fn ccd_finish_build() {
  if (control.status == 0u && control.phase == SEARCH && control.cacheMode == 0u) {
    control.cacheMode = select(1u, 2u, atomicLoad(&control.cacheOverflow) != 0u);
  }
}

// The first reduction is strictly time ordered. The second reduction picks
// the lowest pair ID within the exact minimum's 1e-12 simultaneous window.
// Keeping these separate avoids a non-transitive approximate comparator.
fn candidate_reduction(item: u32, lane: u32, group: u32, ties: bool) {
  var hit = Hit(INF, 0.0, 0xffffffffu, 0xffffffffu);
  if (control.status == 0u && control.phase == SEARCH) {
    if (control.cacheMode == 1u && item < min(atomicLoad(&control.cacheCount), params.candidateCapacity)) {
      let candidate = candidateHits[control.cacheSlot * params.candidateCapacity + item];
      if (!ties || inside_tie_window(candidate)) { hit = candidate; }
    } else if (control.cacheMode == 2u && item < params.count) {
      let offset = (1u - control.activeIndex) * params.count;
      let remaining = max(0.0, (params.dt - control.elapsedHi) - control.elapsedLo);
      for (var j = item + 1u; j < params.count; j++) {
        let toi = impact_time(offset + item, offset + j, remaining);
        if (toi < INF) {
          let time = add_compensated(control.elapsedHi, control.elapsedLo, toi);
          let candidate = Hit(time.x, time.y, item, j);
          if (!ties) { hit = earlier(hit, candidate); }
          else if (inside_tie_window(candidate)) { hit = lower_pair(hit, candidate); }
        }
      }
    }
  }
  hits[lane] = hit; workgroupBarrier();
  for (var stride = 64u; stride > 0u; stride /= 2u) {
    if (lane < stride) {
      if (ties) { hits[lane] = lower_pair(hits[lane], hits[lane + stride]); }
      else { hits[lane] = earlier(hits[lane], hits[lane + stride]); }
    }
    workgroupBarrier();
  }
  if (lane == 0u) { groupHits[group] = hits[0]; }
}

@compute @workgroup_size(128)
fn ccd_scan_min(@builtin(global_invocation_id) id: vec3<u32>,
            @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
  candidate_reduction(id.x, lane, group.x, false);
}

@compute @workgroup_size(128)
fn ccd_minimum(@builtin(local_invocation_index) lane: u32) {
  var hit = Hit(INF, 0.0, 0xffffffffu, 0xffffffffu);
  for (var i = lane; i < params.groups; i += 128u) { hit = earlier(hit, groupHits[i]); }
  hits[lane] = hit; workgroupBarrier();
  for (var stride = 64u; stride > 0u; stride /= 2u) {
    if (lane < stride) { hits[lane] = earlier(hits[lane], hits[lane + stride]); }
    workgroupBarrier();
  }
  if (lane == 0u && control.status == 0u && control.phase == SEARCH) {
    control.driftTime = hits[0].time; control.driftTimeLo = hits[0].timeLo;
  }
}

@compute @workgroup_size(128)
fn ccd_scan_ties(@builtin(global_invocation_id) id: vec3<u32>,
            @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
  candidate_reduction(id.x, lane, group.x, true);
}

@compute @workgroup_size(128)
fn ccd_select(@builtin(local_invocation_index) lane: u32) {
  var hit = Hit(INF, 0.0, 0xffffffffu, 0xffffffffu);
  for (var i = lane; i < params.groups; i += 128u) { hit = lower_pair(hit, groupHits[i]); }
  hits[lane] = hit; workgroupBarrier();
  for (var stride = 64u; stride > 0u; stride /= 2u) {
    if (lane < stride) { hits[lane] = lower_pair(hits[lane], hits[lane + stride]); }
    workgroupBarrier();
  }
  if (lane == 0u && control.status == 0u && control.phase == SEARCH) {
    let remaining = remaining_time();
    if (hits[0].time == INF) {
      control.driftTime = remaining.x; control.driftTimeLo = remaining.y; control.phase = FINISH;
    }
    else {
      let difference = two_sum(hits[0].time, -control.elapsedHi);
      let drift = add_compensated(difference.x, difference.y, hits[0].timeLo - control.elapsedLo);
      if (drift.x + drift.y <= 0.0) { control.driftTime = 0.0; control.driftTimeLo = 0.0; }
      else if ((drift.x - remaining.x) + (drift.y - remaining.y) >= 0.0) {
        control.driftTime = remaining.x; control.driftTimeLo = remaining.y;
      } else { control.driftTime = drift.x; control.driftTimeLo = drift.y; }
      control.selectedI = hits[0].i; control.selectedJ = hits[0].j; control.phase = DRIFT;
    }
  }
}

@compute @workgroup_size(128)
fn ccd_drift(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.count || control.status != 0u || (control.phase != DRIFT && control.phase != FINISH)) { return; }
  let index = (1u - control.activeIndex) * params.count + i;
  if (control.driftTime != 0.0) { move_particle(index, control.driftTime); }
  if (control.driftTimeLo != 0.0) { move_particle(index, control.driftTimeLo); }
}

fn apply_impact(i: u32, j: u32) -> bool {
  let r = (positionHi[j].xyz - positionHi[i].xyz) + (positionLo[j].xyz - positionLo[i].xyz);
  let rr = accurate_dot(r, r);
  if (!(rr > 0.0 && rr < INF)) { return false; }
  let distance = sqrt(rr); let tolerance = contact_tolerance(i, j, r);
  if (!(tolerance < params.diameter * 0.01) || distance < params.diameter - tolerance || distance > params.diameter + tolerance) { return false; }
  let normal = r / distance;
  let vi = velocities[i].xyz; let vj = velocities[j].xyz;
  let normalVelocity = accurate_dot(vj - vi, normal);
  if (!(normalVelocity < -velocity_tolerance(vi, vj))) { return false; }
  let impulse = (1.0 + params.restitution) * normalVelocity * 0.5;
  let nextI = vi + impulse * normal; let nextJ = vj - impulse * normal;
  if (!finite3(nextI) || !finite3(nextJ)) { return false; }
  let dissipation = max(0.0, 0.25 * (1.0 - params.restitution * params.restitution) * normalVelocity * normalVelocity);
  let loss = add_compensated(control.trialLossHi, control.trialLossLo, dissipation);
  if (!(loss.x >= 0.0 && loss.x < INF)) { return false; }
  let correction = (params.diameter - distance) * 0.5;
  add_position(i, -correction * normal, vec3<f32>(0.0));
  add_position(j, correction * normal, vec3<f32>(0.0));
  velocities[i] = vec4<f32>(nextI, 0.0); velocities[j] = vec4<f32>(nextJ, 0.0);
  control.trialLossHi = loss.x; control.trialLossLo = loss.y;
  control.trialEvents += 1u;
  return true;
}

@compute @workgroup_size(1)
fn ccd_impact() {
  if (control.status != 0u || control.phase != DRIFT) { return; }
  let high = add_compensated(control.elapsedHi, control.elapsedLo, control.driftTime);
  let elapsed = add_compensated(high.x, high.y, control.driftTimeLo);
  control.elapsedHi = elapsed.x; control.elapsedLo = elapsed.y;
  let offset = (1u - control.activeIndex) * params.count;
  if (control.trialEvents >= params.maxEvents) { atomicOr(&control.invalid, 4u); }
  else if (!apply_impact(offset + control.selectedI, offset + control.selectedJ)) { atomicOr(&control.invalid, 2u); }
  let fault = atomicLoad(&control.invalid);
  if (fault != 0u) { control.status = 1u; control.fault = fault; return; }
  // Endpoint contacts are not discarded. Cached candidates involving either
  // participant are replaced before the next event selection.
  control.phase = select(SEARCH, UPDATE, control.cacheMode == 1u);
  control.driftTime = 0.0; control.driftTimeLo = 0.0;
}

@compute @workgroup_size(1)
fn ccd_prepare_update() {
  if (control.status != 0u || control.phase != UPDATE) { return; }
  control.oldCacheCount = min(atomicLoad(&control.cacheCount), params.candidateCapacity);
  control.cacheSlot = 1u - control.cacheSlot;
  atomicStore(&control.cacheCount, 0u); atomicStore(&control.cacheOverflow, 0u);
}

// Compact into the other cache slot: nonparticipants keep their absolute TOI.
// This reclaims every invalidated entry each event, so history cannot grow it.
@compute @workgroup_size(128)
fn ccd_retain(@builtin(global_invocation_id) id: vec3<u32>) {
  if (control.status != 0u || control.phase != UPDATE || id.x >= control.oldCacheCount) { return; }
  let hit = candidateHits[(1u - control.cacheSlot) * params.candidateCapacity + id.x];
  if (hit.i != control.selectedI && hit.j != control.selectedI && hit.i != control.selectedJ && hit.j != control.selectedJ) {
    append_candidate(hit);
  }
}

@compute @workgroup_size(128)
fn ccd_participants(@builtin(global_invocation_id) id: vec3<u32>) {
  let item = id.x;
  if (control.status != 0u || control.phase != UPDATE || item >= 2u * params.count) { return; }
  let particle = select(control.selectedI, control.selectedJ, item >= params.count);
  let other = item % params.count;
  if (other == particle || (item >= params.count && other == control.selectedI)) { return; }
  let i = min(particle, other); let j = max(particle, other);
  let offset = (1u - control.activeIndex) * params.count;
  let remaining = max(0.0, (params.dt - control.elapsedHi) - control.elapsedLo);
  let toi = impact_time(offset + i, offset + j, remaining);
  if (toi < INF) {
    let time = add_compensated(control.elapsedHi, control.elapsedLo, toi);
    append_candidate(Hit(time.x, time.y, i, j));
  }
}

@compute @workgroup_size(1)
fn ccd_finish_update() {
  if (control.status != 0u || control.phase != UPDATE) { return; }
  if (atomicLoad(&control.cacheOverflow) != 0u) { control.cacheMode = 2u; }
  control.phase = SEARCH;
}
`;

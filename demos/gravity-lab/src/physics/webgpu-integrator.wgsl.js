import { COLLISION_FUNCTIONS } from './webgpu-collisions.wgsl.js';

// Every entry point is a separate ordered dispatch. No cross-workgroup spin
// barriers, concurrent contact impulses, or unfinished drift commits.
export const INTEGRATOR_SHADER = /* wgsl */ `
const INF: f32 = 3.402823e38;
const READY: u32 = 0u;
const TRIAL: u32 = 1u;
const CCD: u32 = 2u;
const FINISH: u32 = 3u;
const RETRY: u32 = 4u;
const STOP: u32 = 5u;
const INITIAL: u32 = 6u;

struct Parameters {
  count: u32, pairCount: u32, groups: u32, maxEvents: u32,
  gm: f32, diameter: f32, restitution: f32, maxDt: f32,
  travel: f32, contactDt: f32, goal: f32, padding: f32,
}
struct Body {
  position: vec4<f32>, velocity: vec4<f32>, acceleration: vec4<f32>,
  committedPosition: vec4<f32>, committedVelocity: vec4<f32>, committedAcceleration: vec4<f32>,
  positionError: vec4<f32>, committedPositionError: vec4<f32>,
}
struct Control {
  stage: u32, retry: u32, refinements: u32, events: u32,
  dt: f32, elapsed: f32, driftTime: f32, trialLoss: f32,
  selectedPair: u32, lastI: u32, lastJ: u32, invalid: atomic<u32>,
  time: f32, timeComp: f32, progress: f32, progressComp: f32,
  collisions: u32, steps: u32, retries: u32, fault: u32,
  loss: f32, lossComp: f32, contactFailures: u32, eventOverflows: u32,
}
struct Hit { time: f32, pair: u32, }
@group(0) @binding(0) var<uniform> params: Parameters;
@group(0) @binding(1) var<storage, read_write> bodies: array<Body>;
@group(0) @binding(2) var<storage, read_write> control: Control;
@group(0) @binding(3) var<storage, read_write> times: array<f32>;
@group(0) @binding(4) var<storage, read_write> minima: array<Hit>;
@group(0) @binding(5) var<storage, read> pairIndices: array<vec2<u32>>;
// Write-only scheduling resources are absent from indirect-dispatch layouts:
// an indirect input buffer cannot simultaneously be bound as writable storage.
@group(1) @binding(0) var<storage, read_write> indirect: array<u32>;

// Collision helpers use the same resident Body storage as the integrator.
${COLLISION_FUNCTIONS}

var<workgroup> extrema: array<vec2<f32>, 64>;
var<workgroup> hits: array<Hit, 128>;
var<workgroup> tile: array<vec4<f32>, 64>;
var<workgroup> tileError: array<vec4<f32>, 64>;
var<workgroup> prepareNeeded: u32;
var<workgroup> selectionStage: u32;

fn finite3(value: vec3<f32>) -> bool {
  return all(abs(value) <= vec3<f32>(INF));
}
fn earlier(a: Hit, b: Hit) -> Hit {
  // Exact f32 ties use the stable triangular pair ID. A broad epsilon can
  // violate chronological order and is deliberately not used here.
  if (a.time < b.time || (a.time == b.time && a.pair < b.pair)) { return a; }
  return b;
}
fn dispatch_size(offset: u32, groups: u32) {
  indirect[offset] = groups; indirect[offset + 1u] = 1u; indirect[offset + 2u] = 1u;
}
fn dispatches() {
  let bodyGroups = (params.count + 63u) / 64u;
  dispatch_size(0u, select(0u, bodyGroups, control.stage == TRIAL));
  dispatch_size(3u, select(0u, params.groups, control.stage == TRIAL));
  dispatch_size(6u, select(0u, bodyGroups, (control.stage == CCD || control.stage == FINISH) && control.driftTime > 0.0));
  dispatch_size(9u, select(0u, (2u * params.count + 63u) / 64u, control.stage == CCD));
  dispatch_size(12u, select(0u, params.groups, control.stage == CCD));
  dispatch_size(15u, select(0u, bodyGroups, control.stage == FINISH || control.stage == INITIAL));
  dispatch_size(18u, select(0u, bodyGroups, control.stage == FINISH || control.stage == INITIAL));
}
fn retry_step(nextDt: f32) {
  control.dt = nextDt;
  control.retry += 1u; control.retries += 1u;
  control.stage = RETRY; control.driftTime = 0.0;
  if (control.retry >= 12u || nextDt < 1e-9) {
    control.stage = STOP; control.fault = 2u;
  }
}

@compute @workgroup_size(1)
fn request() {
  control.progress = 0.0; control.progressComp = 0.0;
  // A command/control boundary can shorten the target while an atomic drift
  // is pending. Discard that uncommitted trial rather than overshooting it.
  if ((control.stage == CCD || control.stage == RETRY || control.stage == TRIAL)
      && control.dt > params.goal) { control.stage = READY; }
  dispatches();
}

@compute @workgroup_size(64)
fn prepare(@builtin(local_invocation_index) lane: u32) {
  if (lane == 0u) {
    let remaining = params.goal - (control.progress - control.progressComp);
    prepareNeeded = select(0u, 1u, control.stage == READY && remaining > max(1e-8, params.goal * 2e-7));
  }
  // The builtin broadcasts a workgroup-uniform decision, so all lanes take
  // the same branch around barriers even though stage lives in storage.
  let needed = workgroupUniformLoad(&prepareNeeded);
  if (needed == 1u) {
    var maximum = vec2<f32>(0.0);
    for (var i = lane; i < params.count; i += 64u) {
      let v = bodies[i].committedVelocity.xyz;
      let a = bodies[i].committedAcceleration.xyz;
      maximum = max(maximum, vec2<f32>(dot(v, v), dot(a, a)));
    }
    extrema[lane] = maximum;
    workgroupBarrier();
    for (var stride = 32u; stride > 0u; stride /= 2u) {
      if (lane < stride) { extrema[lane] = max(extrema[lane], extrema[lane + stride]); }
      workgroupBarrier();
    }
  }
  if (lane == 0u) {
    control.driftTime = 0.0;
    let remaining = max(0.0, params.goal - (control.progress - control.progressComp));
    if (control.stage == READY && remaining > max(1e-8, params.goal * 2e-7)) {
      let vmax = sqrt(extrema[0].x); let amax = sqrt(extrema[0].y);
      let safeDt = min(params.maxDt, min(params.travel / max(2.0 * vmax, 1e-20), sqrt(params.travel / max(2.0 * amax, 1e-20))));
      control.dt = min(remaining, safeDt);
      control.retry = 0u; control.stage = TRIAL;
      if (!(control.dt > 0.0 && control.dt <= INF)) { control.stage = STOP; control.fault = 1u; }
    } else if (control.stage == RETRY) { control.stage = TRIAL; }
    if (control.stage == TRIAL) {
      control.elapsed = 0.0; control.events = 0u; control.trialLoss = 0.0;
      atomicStore(&control.invalid, 0u);
    }
    dispatches();
  }
}

@compute @workgroup_size(64)
fn begin_trial(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i >= params.count) { return; }
  // Committed state doubles as an immutable rollback backup for every retry.
  bodies[i].position = bodies[i].committedPosition;
  bodies[i].positionError = bodies[i].committedPositionError;
  bodies[i].acceleration = bodies[i].committedAcceleration;
  bodies[i].velocity = vec4<f32>(bodies[i].committedVelocity.xyz + bodies[i].acceleration.xyz * (control.dt * 0.5), 0.0);
}

@compute @workgroup_size(64)
fn restore_committed(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i >= params.count) { return; }
  bodies[i].position = bodies[i].committedPosition;
  bodies[i].positionError = bodies[i].committedPositionError;
  bodies[i].velocity = bodies[i].committedVelocity;
  bodies[i].acceleration = bodies[i].committedAcceleration;
}

@compute @workgroup_size(128)
fn initial_pairs(@builtin(global_invocation_id) id: vec3<u32>,
                 @builtin(local_invocation_index) lane: u32,
                 @builtin(workgroup_id) group: vec3<u32>) {
  let pair = id.x;
  var hit = Hit(INF, 0xffffffffu);
  if (pair < params.pairCount) {
    let ij = pair_ids(pair);
    hit = Hit(impact_time(ij.x, ij.y, control.dt, control.dt > params.contactDt * 1.001), pair);
    times[pair] = hit.time;
  }
  hits[lane] = hit; workgroupBarrier();
  for (var stride = 64u; stride > 0u; stride /= 2u) {
    if (lane < stride) { hits[lane] = earlier(hits[lane], hits[lane + stride]); }
    workgroupBarrier();
  }
  if (lane == 0u) { minima[group.x] = hits[0]; }
}

@compute @workgroup_size(128)
fn select_hit(@builtin(local_invocation_index) lane: u32) {
  if (lane == 0u) { selectionStage = control.stage; }
  let stage = workgroupUniformLoad(&selectionStage);
  if (stage != TRIAL && stage != CCD) {
    if (lane == 0u) { control.driftTime = 0.0; dispatches(); }
    return;
  }
  var hit = Hit(INF, 0xffffffffu);
  for (var i = lane; i < params.groups; i += 128u) { hit = earlier(hit, minima[i]); }
  hits[lane] = hit; workgroupBarrier();
  for (var stride = 64u; stride > 0u; stride /= 2u) {
    if (lane < stride) { hits[lane] = earlier(hits[lane], hits[lane + stride]); }
    workgroupBarrier();
  }
  if (lane == 0u) {
    control.driftTime = 0.0;
    if (control.stage == TRIAL || control.stage == CCD) {
      let first = hits[0]; let remaining = max(0.0, control.dt - control.elapsed);
      if (first.time == INF || first.time > control.dt || remaining <= 0.0) {
        control.stage = FINISH; control.driftTime = remaining;
      } else if (control.stage == TRIAL && control.dt > params.contactDt * 1.001) {
        control.refinements += 1u;
        retry_step(max(params.contactDt, min(control.dt * 0.5, first.time)));
      } else {
        control.stage = CCD;
        control.selectedPair = first.pair;
        control.driftTime = clamp(first.time - control.elapsed, 0.0, remaining);
      }
    }
    dispatches();
  }
}

@compute @workgroup_size(64)
fn drift(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i >= params.count) { return; }
  let distance = bodies[i].velocity.xyz * control.driftTime;
  let productError = fma(bodies[i].velocity.xyz, vec3<f32>(control.driftTime), -distance);
  collision_move(i, distance);
  bodies[i].positionError = vec4<f32>(bodies[i].positionError.xyz - productError, 0.0);
}

@compute @workgroup_size(1)
fn impact() {
  if (control.stage == CCD) {
    let ij = pair_ids(control.selectedPair);
    control.elapsed = min(control.dt, control.elapsed + control.driftTime);
    control.lastI = ij.x; control.lastJ = ij.y;
    if (!apply_impact(ij.x, ij.y)) { control.contactFailures += 1u; retry_step(control.dt * 0.5); }
    else if (control.events >= params.maxEvents) { control.eventOverflows += 1u; retry_step(control.dt * 0.5); }
    else if (control.elapsed >= control.dt) { control.stage = FINISH; }
  }
  control.driftTime = 0.0;
  dispatches();
}

fn pair_index(i: u32, j: u32) -> u32 {
  let lo = min(i, j); let hi = max(i, j);
  return lo * (2u * params.count - lo - 1u) / 2u + hi - lo - 1u;
}
@compute @workgroup_size(64)
fn participant_pairs(@builtin(global_invocation_id) id: vec3<u32>) {
  let item = id.x; if (item >= 2u * params.count) { return; }
  let k = item % params.count;
  let i = select(control.lastI, control.lastJ, item >= params.count);
  // The shared pair belongs only to lastI's lane, avoiding concurrent writes.
  if (k == i || (item >= params.count && k == control.lastI)) { return; }
  let pair = pair_index(i, k);
  let toi = impact_time(min(i, k), max(i, k), max(0.0, control.dt - control.elapsed), false);
  times[pair] = select(INF, control.elapsed + toi, toi != INF);
}

@compute @workgroup_size(128)
fn reduce_pairs(@builtin(global_invocation_id) id: vec3<u32>,
                @builtin(local_invocation_index) lane: u32,
                @builtin(workgroup_id) group: vec3<u32>) {
  var hit = Hit(INF, 0xffffffffu);
  if (id.x < params.pairCount) { hit = Hit(times[id.x], id.x); }
  hits[lane] = hit; workgroupBarrier();
  for (var stride = 64u; stride > 0u; stride /= 2u) {
    if (lane < stride) { hits[lane] = earlier(hits[lane], hits[lane + stride]); }
    workgroupBarrier();
  }
  if (lane == 0u) { minima[group.x] = hits[0]; }
}

@compute @workgroup_size(64)
fn forces(@builtin(global_invocation_id) id: vec3<u32>,
          @builtin(local_invocation_index) lane: u32) {
  let i = id.x; let is_active = i < params.count;
  var position = vec3<f32>(0.0);
  var positionError = vec3<f32>(0.0);
  if (is_active) { position = bodies[i].position.xyz; positionError = bodies[i].positionError.xyz; }
  var acceleration = vec3<f32>(0.0); var compensation = vec3<f32>(0.0);
  for (var base = 0u; base < params.count; base += 64u) {
    let source = base + lane;
    if (source < params.count) { tile[lane] = bodies[source].position; tileError[lane] = bodies[source].positionError; }
    else { tile[lane] = vec4<f32>(0.0); tileError[lane] = vec4<f32>(0.0); }
    workgroupBarrier();
    if (is_active && params.gm != 0.0) {
      let length = min(64u, params.count - base);
      for (var k = 0u; k < length; k++) {
        if (base + k != i) {
          let delta = (tile[k].xyz - position) - (tileError[k].xyz - positionError); let distance2 = dot(delta, delta);
          if (!(distance2 > 0.0 && distance2 <= INF)) { atomicOr(&control.invalid, 1u); }
          else {
            let magnitude = params.gm / distance2;
            if (magnitude == 0.0) { atomicOr(&control.invalid, 1u); }
            let contribution = delta * (1.0 / sqrt(distance2)) * magnitude;
            let corrected = contribution - compensation;
            let sum = acceleration + corrected;
            compensation = (sum - acceleration) - corrected; acceleration = sum;
          }
        }
      }
    }
    workgroupBarrier();
  }
  if (is_active) {
    if (!finite3(acceleration)) { atomicOr(&control.invalid, 1u); }
    bodies[i].acceleration = vec4<f32>(acceleration, 0.0);
  }
}

@compute @workgroup_size(64)
fn final_kick(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i >= params.count) { return; }
  if (control.stage == FINISH) {
    bodies[i].velocity = vec4<f32>(bodies[i].velocity.xyz + bodies[i].acceleration.xyz * (control.dt * 0.5), 0.0);
  }
  if (!finite3(bodies[i].position.xyz) || !finite3(bodies[i].positionError.xyz)
      || !finite3(bodies[i].velocity.xyz)) { atomicOr(&control.invalid, 1u); }
  // Once spatial ULP approaches a noticeable fraction of the hard sphere,
  // stop instead of silently treating indistinguishable contacts as separated.
  let coordinate = max(abs(bodies[i].position.x), max(abs(bodies[i].position.y), abs(bodies[i].position.z)));
  if (coordinate * 1.1920929e-7 > params.diameter * 0.001) { atomicOr(&control.invalid, 1u); }
}

@compute @workgroup_size(64)
fn publish(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i >= params.count || atomicLoad(&control.invalid) != 0u) { return; }
  bodies[i].committedPosition = bodies[i].position;
  bodies[i].committedVelocity = bodies[i].velocity;
  bodies[i].committedAcceleration = bodies[i].acceleration;
  bodies[i].committedPositionError = bodies[i].positionError;
}

@compute @workgroup_size(1)
fn validate_commit() {
  if (control.stage == FINISH) {
    let nextTime = control.time + (control.dt - control.timeComp);
    let nextProgress = control.progress + (control.dt - control.progressComp);
    let nextLoss = control.loss + (control.trialLoss - control.lossComp);
    if (!(nextTime >= 0.0 && nextTime < INF && nextProgress >= 0.0 && nextProgress < INF && nextLoss >= 0.0 && nextLoss < INF)
        || control.steps == 0xffffffffu || control.collisions > 0xffffffffu - control.events) {
      atomicOr(&control.invalid, 1u);
    }
  }
}

@compute @workgroup_size(1)
fn commit() {
  if (control.stage == FINISH || control.stage == INITIAL) {
    if (atomicLoad(&control.invalid) != 0u) { control.stage = STOP; control.fault = 3u; }
    else if (control.stage == INITIAL) { control.stage = READY; }
    else {
      let timeDelta = control.dt - control.timeComp;
      let nextTime = control.time + timeDelta;
      control.timeComp = (nextTime - control.time) - timeDelta; control.time = nextTime;
      let progressDelta = control.dt - control.progressComp;
      let nextProgress = control.progress + progressDelta;
      control.progressComp = (nextProgress - control.progress) - progressDelta; control.progress = nextProgress;
      let lossDelta = control.trialLoss - control.lossComp;
      let nextLoss = control.loss + lossDelta;
      control.lossComp = (nextLoss - control.loss) - lossDelta; control.loss = nextLoss;
      control.collisions += control.events; control.steps += 1u;
      control.stage = READY;
    }
  }
  dispatches();
}
`;

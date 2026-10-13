/**
 * Append to a shader declaring INF and these storage/uniform bindings:
 *   params.count: u32, params.diameter: f32, params.restitution: f32;
 *   bodies: array<Body>, with position/velocity/positionError: vec4<f32>;
 *   pairIndices: array<vec2<u32>>, lexicographic i<j (read);
 *   control.trialLoss: f32, control.events: u32 (read_write).
 * The fourth position/velocity components are padding, written as zero. All particles have
 * equal unit mass for the loss accumulator, as in the CPU collision solver.
 *
 * impact_time reads a stable, fully drifted state. apply_impact must run in a
 * separate dispatch with exactly one invocation; its writes are not atomic.
 * A false impact result invalidates the trial and must cause rollback/refine,
 * rather than silently discarding a selected event. The caller also bounds
 * events per trial so physically dense repeated contacts cannot loop forever.
 */
export const COLLISION_FUNCTIONS = /* wgsl */ `
const COLLISION_F32_EPS: f32 = 1.1920928955078125e-7;

fn collision_dot(a: vec3<f32>, b: vec3<f32>) -> f32 {
  return fma(a.x, b.x, fma(a.y, b.y, a.z * b.z));
}

fn collision_max_component(v: vec3<f32>) -> f32 {
  let a = abs(v);
  return max(a.x, max(a.y, a.z));
}

// Several ULPs cover stored coordinates, subtraction, and the preceding drift.
// There is no world-unit epsilon and no enlargement of the physical diameter.
fn collision_contact_tolerance(a: vec3<f32>, b: vec3<f32>) -> f32 {
  let scale = max(params.diameter,
    max(collision_max_component(a), collision_max_component(b)));
  return 4.0 * COLLISION_F32_EPS * scale;
}

// Zero normal motion after an inelastic impact can round slightly negative.
// Use the velocity's own precision, including a large common bulk velocity,
// so this numerical residual cannot repeatedly schedule the same zero event.
fn collision_velocity_tolerance(a: vec3<f32>, b: vec3<f32>) -> f32 {
  let scale = max(collision_max_component(a), collision_max_component(b));
  return 4.0 * COLLISION_F32_EPS * scale;
}

fn collision_pair_start(i: u32) -> u32 {
  // Divide the even factor first to avoid an unnecessary u32 overflow.
  let other = 2u * params.count - i - 1u;
  if ((i & 1u) == 0u) { return (i / 2u) * other; }
  return i * (other / 2u);
}

// Lexicographic triangle uploaded once: (0,1), (0,2), ..., (1,2), ... .
fn pair_ids(index: u32) -> vec2<u32> {
  let count = params.count;
  if (count < 2u) { return vec2<u32>(count); }
  let pair_count = collision_pair_start(count - 1u);
  if (index >= pair_count) { return vec2<u32>(count); }
  return pairIndices[index];
}

// Continuous sphere TOI during a constant-velocity drift. The equivalent
// c / (-b + sqrt(discriminant)) root avoids subtracting nearly equal numbers.
fn impact_time(i: u32, j: u32, duration: f32, probe: bool) -> f32 {
  if (i >= params.count || j >= params.count || i == j ||
      !(params.diameter > 0.0) || !(duration >= 0.0)) { return INF; }
  let pi = bodies[i].position.xyz;
  let pj = bodies[j].position.xyz;
  let vi = bodies[i].velocity.xyz;
  let vj = bodies[j].velocity.xyz;
  let r = (pj - pi) - (bodies[j].positionError.xyz - bodies[i].positionError.xyz);
  let v = vj - vi;
  let tolerance = collision_contact_tolerance(pi, pj);
  // Conservative swept-axis rejection. If a coordinate cannot reach the
  // contact diameter anywhere in this drift, the spheres cannot collide.
  // This rejects distant pairs before dot products and square roots.
  if (any(abs(r) > vec3<f32>(params.diameter + tolerance) + abs(v) * duration)) { return INF; }
  let rr = collision_dot(r, r);
  if (!(rr >= 0.0 && rr < INF)) { return 0.0; }
  let distance = sqrt(rr);
  // A real penetration is invalid even if this pair is already separating.
  // Returning a zero candidate sends it through apply_impact's failure path.
  if (distance < params.diameter - tolerance) { return 0.0; }
  let b = collision_dot(r, v);
  let closing_tolerance = collision_velocity_tolerance(vi, vj);
  if (!(b < -closing_tolerance * distance)) { return INF; }
  let a = collision_dot(v, v);
  if (!(a > 0.0 && a < INF)) { return INF; }
  let c = fma(-params.diameter, params.diameter, rr);
  // Stored coordinates cannot distinguish a smaller gap than this tolerance.
  // Resolve such approaching contacts once rather than repeatedly aiming a
  // new KDK trial at a boundary below f32 position resolution.
  if (distance <= params.diameter + tolerance) { return 0.0; }
  let discriminant = fma(-a, c, b * b);
  if (!(discriminant >= 0.0 && discriminant < INF)) { return INF; }
  let denominator = -b + sqrt(discriminant);
  if (!(denominator > 0.0)) { return INF; }
  let time = c / denominator;
  let time_tolerance = max(8.0 * COLLISION_F32_EPS * max(duration, time),
    select(tolerance / sqrt(a), 0.0, probe));
  if (!(time >= 0.0)) { return INF; }
  if (time > duration + time_tolerance) {
    if (!probe) { return INF; }
    // A coarse-step probe must not pull an outside contact into its horizon
    // by world-coordinate tolerance / speed: sparse, slow shells repeatedly
    // refine that false prediction. Check an uncertain root at the endpoint
    // using local arithmetic scale instead. Short-step event resolution still
    // uses the contact envelope and validates/rolls back every actual impulse.
    let endpoint = fma(v, vec3<f32>(duration), r);
    let local_scale = max(params.diameter,
      max(collision_max_component(r), collision_max_component(v) * duration));
    let endpoint_tolerance = 8.0 * COLLISION_F32_EPS * local_scale;
    if (collision_dot(endpoint, endpoint) >
        (params.diameter + endpoint_tolerance) * (params.diameter + endpoint_tolerance)) { return INF; }
  }
  let bounded_time = min(time, duration);
  // An exactly tangent encounter has no impulse. This also rejects tangencies
  // made spuriously approaching only by the quadratic's f32 round-off.
  if (!(fma(a, bounded_time, b) < -closing_tolerance * params.diameter)) {
    return INF;
  }
  return bounded_time;
}

// Keep the sub-ULP remainder of each drift/contact shift. All arithmetic is
// f32, but repeated tiny accepted steps need not disappear into large centres.
fn collision_move(i: u32, distance: vec3<f32>) {
  let old = bodies[i].position.xyz;
  let corrected = distance - bodies[i].positionError.xyz;
  let next = old + corrected;
  bodies[i].positionError = vec4<f32>((next - old) - corrected, 0.0);
  bodies[i].position = vec4<f32>(next, 0.0);
}

fn apply_impact(i: u32, j: u32) -> bool {
  if (i >= params.count || j >= params.count || i == j ||
      !(params.diameter > 0.0)) { return false; }
  let pi = bodies[i].position;
  let pj = bodies[j].position;
  let vi = bodies[i].velocity;
  let vj = bodies[j].velocity;
  let r = (pj.xyz - pi.xyz) - (bodies[j].positionError.xyz - bodies[i].positionError.xyz);
  let rr = collision_dot(r, r);
  if (!(rr > 0.0 && rr < INF)) { return false; }
  let distance = sqrt(rr);
  let tolerance = collision_contact_tolerance(pi.xyz, pj.xyz);
  // Large coordinates cannot justify macroscopically changing the contact
  // surface. Such a state needs a recentered upload or a failed-trial fallback.
  // Use exactly the TOI interval: in f32, abs(distance - diameter) <= tolerance
  // is not equivalent at a rounded endpoint to distance <= diameter + tolerance.
  if (!(tolerance < params.diameter * 0.01) ||
      distance < params.diameter - tolerance ||
      distance > params.diameter + tolerance) { return false; }
  let normal = r / distance;
  let normal_velocity = collision_dot(vj.xyz - vi.xyz, normal);
  if (!(normal_velocity < -collision_velocity_tolerance(vi.xyz, vj.xyz))) {
    return false;
  }
  let restitution = clamp(params.restitution, 0.0, 1.0);
  let impulse = (1.0 + restitution) * normal_velocity * 0.5;
  let next_vi = vi.xyz + impulse * normal;
  let next_vj = vj.xyz - impulse * normal;
  if (!(all(abs(next_vi) < vec3<f32>(INF)) &&
        all(abs(next_vj) < vec3<f32>(INF)))) { return false; }
  let dissipation = max(0.0,
    0.25 * (1.0 - restitution * restitution) * normal_velocity * normal_velocity);
  if (!(dissipation >= 0.0 && dissipation < INF &&
        control.trialLoss + dissipation < INF)) { return false; }
  // Only round-off contact repair, equal and opposite. No velocity is added by
  // separation, no artificial gap is left, and the physical radius is fixed.
  let correction = (params.diameter - distance) * 0.5;
  collision_move(i, -correction * normal);
  collision_move(j, correction * normal);
  bodies[i].velocity = vec4<f32>(next_vi, 0.0);
  bodies[j].velocity = vec4<f32>(next_vj, 0.0);
  // Same equal-mass e formula as the Float64 CPU solver; f32 conservation
  // error is observed by diagnostics rather than introducing extra damping.
  control.trialLoss += dissipation;
  control.events += 1u;
  return true;
}
`;

/** Plummer acceleration; softening = 0 preserves Newtonian hard-sphere gravity. */
export function directForces(positions, count, gm, out = new Float64Array(count * 3), softening = 0) {
  out.fill(0);
  if (!gm) return out;
  const softening2 = softening * softening;
  for (let i = 0; i < count; i++) {
    const a = i * 3;
    let ax = out[a], ay = out[a + 1], az = out[a + 2];
    for (let j = i + 1; j < count; j++) {
      const b = j * 3;
      const x = positions[b] - positions[a];
      const y = positions[b + 1] - positions[a + 1];
      const z = positions[b + 2] - positions[a + 2];
      const d2 = x * x + y * y + z * z + softening2;
      if (d2 === 0) {
        throw new Error('Coincident sphere centres are not a valid hard-sphere state.');
      }
      const f = gm / (d2 * Math.sqrt(d2));
      ax += x * f; ay += y * f; az += z * f;
      out[b] -= x * f; out[b + 1] -= y * f; out[b + 2] -= z * f;
    }
    out[a] = ax; out[a + 1] = ay; out[a + 2] = az;
  }
  return out;
}

export function potentialEnergy(positions, count, G, mass, softening = 0) {
  let potential = 0;
  if (!G) return potential;
  const coefficient = G * mass * mass;
  const softening2 = softening * softening;
  for (let i = 0; i < count; i++) {
    const a = i * 3;
    for (let j = i + 1; j < count; j++) {
      const b = j * 3;
      const x = positions[b] - positions[a], y = positions[b + 1] - positions[a + 1], z = positions[b + 2] - positions[a + 2];
      potential -= coefficient / Math.sqrt(x * x + y * y + z * z + softening2);
    }
  }
  return potential;
}

/** Independent Float64 reference for explicitly sampled target accelerations. */
export function sampleForceError(positions, count, gm, computed, indices, softening = 0) {
  if (!computed || !indices || computed.length !== indices.length * 3) return null;
  if (!gm) return computed.every(value => value === 0) ? 0 : null;
  let err2 = 0, ref2 = 0;
  const softening2 = softening * softening;
  for (let sample = 0; sample < indices.length; sample++) {
    const i = indices[sample], p = i * 3;
    let ax = 0, ay = 0, az = 0;
    for (let j = 0; j < count; j++) {
      if (i === j) continue;
      const q = j * 3;
      const x = positions[q] - positions[p], y = positions[q + 1] - positions[p + 1], z = positions[q + 2] - positions[p + 2];
      const d2 = x * x + y * y + z * z + softening2;
      if (!(d2 > 0) || !Number.isFinite(d2)) return null;
      const f = gm / (d2 * Math.sqrt(d2));
      ax += x * f; ay += y * f; az += z * f;
    }
    const offset = sample * 3;
    err2 += (computed[offset] - ax) ** 2 + (computed[offset + 1] - ay) ** 2 + (computed[offset + 2] - az) ** 2;
    ref2 += ax * ax + ay * ay + az * az;
  }
  const error = Math.sqrt(err2 / Math.max(ref2, 1e-30));
  return Number.isFinite(error) ? error : null;
}

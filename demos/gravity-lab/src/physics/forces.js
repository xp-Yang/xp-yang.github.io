/** Newtonian centre-to-centre acceleration. gm is G times the common mass. */
export function directForces(positions, count, gm, out = new Float64Array(count * 3)) {
  out.fill(0);
  if (!gm) return out;
  for (let i = 0; i < count; i++) {
    const a = i * 3;
    let ax = out[a], ay = out[a + 1], az = out[a + 2];
    for (let j = i + 1; j < count; j++) {
      const b = j * 3;
      const x = positions[b] - positions[a];
      const y = positions[b + 1] - positions[a + 1];
      const z = positions[b + 2] - positions[a + 2];
      const d2 = x * x + y * y + z * z;
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

const NODE_FLOAT_FIELDS = ['cx', 'cy', 'cz', 'half', 'x', 'y', 'z', 'width2'];

function reserveParticles(work, required) {
  if (required <= work.particleCapacity) return;
  let capacity = Math.max(16, work.particleCapacity);
  while (capacity < required) capacity *= 2;
  work.particleCapacity = capacity;
  work.indices = new Int32Array(capacity);
  work.partition = new Int32Array(capacity);
  work.octants = new Uint8Array(capacity);
  work.ranks = new Int32Array(capacity);
  work.sortedX = new Float64Array(capacity);
  work.sortedY = new Float64Array(capacity);
  work.sortedZ = new Float64Array(capacity);
}

function reserveNodes(work, required) {
  if (required <= work.nodeCapacity) return;
  let capacity = Math.max(16, work.nodeCapacity);
  while (capacity < required) capacity *= 2;
  for (const key of NODE_FLOAT_FIELDS) {
    const next = new Float64Array(capacity);
    next.set(work[key]);
    work[key] = next;
  }
  const counts = new Int32Array(capacity);
  counts.set(work.counts);
  work.counts = counts;
  const starts = new Int32Array(capacity);
  starts.set(work.starts);
  work.starts = starts;
  const childCounts = new Uint8Array(capacity);
  childCounts.set(work.childCounts);
  work.childCounts = childCounts;
  const children = new Int32Array(capacity * 8);
  children.set(work.children);
  work.children = children;
  const next = new Int32Array(capacity);
  next.set(work.next);
  work.next = next;
  const open = new Int32Array(capacity);
  open.set(work.open);
  work.open = open;
  work.nodeCapacity = capacity;
}

/** Reusable storage for a force solver. Each Simulation may own one workspace. */
export function createForceWorkspace(count = 0) {
  const work = {
    particleCapacity: 0,
    nodeCapacity: 0,
    nodeCount: 0,
    indices: new Int32Array(0),
    partition: new Int32Array(0),
    octants: new Uint8Array(0),
    ranks: new Int32Array(0),
    sortedX: new Float64Array(0),
    sortedY: new Float64Array(0),
    sortedZ: new Float64Array(0),
    counts: new Int32Array(0),
    starts: new Int32Array(0),
    childCounts: new Uint8Array(0),
    children: new Int32Array(0),
    next: new Int32Array(0),
    open: new Int32Array(0),
    // Depth-local partition counters survive recursive child builds.
    bucketCounts: new Int32Array(40 * 8),
    bucketOffsets: new Int32Array(40 * 8),
  };
  for (const key of NODE_FLOAT_FIELDS) work[key] = new Float64Array(0);
  reserveParticles(work, count);
  reserveNodes(work, Math.max(16, work.particleCapacity * 2));
  return work;
}

let defaultWorkspace;

function buildNode(positions, work, start, count, cx, cy, cz, half, depth, nextVisit) {
  const index = work.nodeCount++;
  reserveNodes(work, work.nodeCount);
  const indices = work.indices;
  const octants = work.octants;
  const buckets = work.bucketCounts;
  const offsets = work.bucketOffsets;
  const base = depth * 8;
  const leaf = count <= 8 || depth >= 40 || half < 1e-12;
  if (!leaf) buckets.fill(0, base, base + 8);
  let x = 0, y = 0, z = 0;
  const end = start + count;
  for (let k = start; k < end; k++) {
    const id = indices[k], p = id * 3;
    const px = positions[p], py = positions[p + 1], pz = positions[p + 2];
    x += px; y += py; z += pz;
    if (!leaf) {
      const octant = (px >= cx ? 1 : 0) | (py >= cy ? 2 : 0) | (pz >= cz ? 4 : 0);
      octants[id] = octant;
      buckets[base + octant]++;
    }
  }
  work.cx[index] = cx; work.cy[index] = cy; work.cz[index] = cz;
  work.half[index] = half;
  work.width2[index] = 4 * half * half;
  work.x[index] = x / count; work.y[index] = y / count; work.z[index] = z / count;
  work.counts[index] = count;
  work.starts[index] = start;
  work.childCounts[index] = 0;
  work.next[index] = nextVisit;
  work.open[index] = -1;
  if (leaf) return index;

  let offset = start;
  for (let k = 0; k < 8; k++) {
    offsets[base + k] = offset;
    offset += buckets[base + k];
  }
  // Stable partition keeps the same body and summation order as the object tree.
  const partition = work.partition;
  for (let k = start; k < end; k++) {
    const id = indices[k];
    partition[offsets[base + octants[id]]++] = id;
  }
  for (let k = start; k < end; k++) indices[k] = partition[k];

  const h = half / 2;
  offset = start;
  let childCount = 0;
  for (let k = 0; k < 8; k++) {
    const size = buckets[base + k];
    if (size) {
      // Original traversal pushes ascending octants, then visits them in reverse.
      const childNext = childCount ? work.children[index * 8 + childCount - 1] : nextVisit;
      const child = buildNode(positions, work, offset, size,
        cx + (k & 1 ? h : -h), cy + (k & 2 ? h : -h), cz + (k & 4 ? h : -h), h, depth + 1, childNext);
      // Node arrays can grow inside the recursive call; use the current buffer.
      work.children[index * 8 + childCount++] = child;
    }
    offset += size;
  }
  work.childCounts[index] = childCount;
  work.open[index] = work.children[index * 8 + childCount - 1];
  return index;
}

function buildFlatOctree(positions, count, work) {
  reserveParticles(work, count);
  work.nodeCount = 0;
  if (!count) return;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count * 3; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
  }
  for (let i = 0; i < count; i++) work.indices[i] = i;
  const half = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-8) * .50000001;
  buildNode(positions, work, 0, count, (minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2, half, 0, -1);
  // Leaf force loops read contiguous coordinates without an id-to-position lookup.
  const { indices, ranks, sortedX, sortedY, sortedZ } = work;
  for (let k = 0; k < count; k++) {
    const id = indices[k], p = id * 3;
    ranks[id] = k;
    sortedX[k] = positions[p]; sortedY[k] = positions[p + 1]; sortedZ[k] = positions[p + 2];
  }
}

/** Compatibility/debug representation; force calculation uses the flat tree directly. */
export function buildOctree(positions, count) {
  const work = createForceWorkspace(count);
  buildFlatOctree(positions, count, work);
  const nodes = new Array(work.nodeCount);
  for (let i = 0; i < work.nodeCount; i++) {
    const childCount = work.childCounts[i];
    const node = {
      cx: work.cx[i], cy: work.cy[i], cz: work.cz[i], half: work.half[i],
      x: work.x[i], y: work.y[i], z: work.z[i], count: work.counts[i],
      ids: null, children: null,
    };
    if (childCount) node.children = Array.from(work.children.subarray(i * 8, i * 8 + childCount));
    else node.ids = Array.from(work.indices.subarray(work.starts[i], work.starts[i] + work.counts[i]));
    nodes[i] = node;
  }
  return nodes;
}

export function computeForces(positions, count, gm, theta = 0, out = new Float64Array(count * 3), workspace) {
  if (theta <= 0 || count <= 64) return directForces(positions, count, gm, out);
  out.fill(0);
  if (!gm) return out;
  const work = workspace || (defaultWorkspace ||= createForceWorkspace(count));
  buildFlatOctree(positions, count, work);
  const { cx, cy, cz, half, x: comX, y: comY, z: comZ, width2,
    counts, starts, next, open, ranks, sortedX, sortedY, sortedZ } = work;
  const theta2 = theta * theta;
  for (let i = 0; i < count; i++) {
    const p = i * 3, px = positions[p], py = positions[p + 1], pz = positions[p + 2];
    const rank = ranks[i];
    let node = 0, ax = 0, ay = 0, az = 0;
    while (node >= 0) {
      const child = open[node];
      if (child < 0) {
        const end = starts[node] + counts[node];
        for (let k = starts[node]; k < end; k++) {
          if (k === rank) continue;
          const x = sortedX[k] - px, y = sortedY[k] - py, z = sortedZ[k] - pz;
          const d2 = x * x + y * y + z * z;
          if (d2 === 0) {
            throw new Error('Coincident sphere centres are not a valid hard-sphere state.');
          }
          const f = gm / (d2 * Math.sqrt(d2));
          ax += x * f; ay += y * f; az += z * f;
        }
        node = next[node];
        continue;
      }
      const x = comX[node] - px, y = comY[node] - py, z = comZ[node] - pz;
      const d2 = x * x + y * y + z * z;
      if (width2[node] < theta2 * d2) {
        // Most rejected nodes need no cube-coordinate loads or containment checks.
        const h = half[node];
        const contains = Math.abs(px - cx[node]) <= h && Math.abs(py - cy[node]) <= h && Math.abs(pz - cz[node]) <= h;
        if (!contains) {
          const f = gm * counts[node] / (d2 * Math.sqrt(d2));
          ax += x * f; ay += y * f; az += z * f;
          node = next[node];
          continue;
        }
      }
      node = child;
    }
    out[p] = ax; out[p + 1] = ay; out[p + 2] = az;
  }
  return out;
}

export function potentialEnergy(positions, count, G, mass) {
  let potential = 0;
  if (!G) return potential;
  const coefficient = G * mass * mass;
  for (let i = 0; i < count; i++) {
    const a = i * 3;
    for (let j = i + 1; j < count; j++) {
      const b = j * 3;
      const x = positions[b] - positions[a], y = positions[b + 1] - positions[a + 1], z = positions[b + 2] - positions[a + 2];
      potential -= coefficient / Math.sqrt(x * x + y * y + z * z);
    }
  }
  return potential;
}

/** RMS error relative to the RMS exact force of a reproducible sample. */
export function sampleForceError(positions, count, gm, theta, computed, sampleCount = 24, compareDirect = false) {
  if ((!compareDirect && (theta <= 0 || count <= 64)) || !gm) return 0;
  let err2 = 0, ref2 = 0;
  const samples = Math.min(count, sampleCount);
  for (let s = 0; s < samples; s++) {
    const i = Math.floor(s * count / samples), p = i * 3;
    let ax = 0, ay = 0, az = 0;
    for (let j = 0; j < count; j++) {
      if (i === j) continue;
      const q = j * 3;
      const x = positions[q] - positions[p], y = positions[q + 1] - positions[p + 1], z = positions[q + 2] - positions[p + 2];
      const d2 = x * x + y * y + z * z;
      const f = gm / (d2 * Math.sqrt(d2));
      ax += x * f; ay += y * f; az += z * f;
    }
    err2 += (computed[p] - ax) ** 2 + (computed[p + 1] - ay) ** 2 + (computed[p + 2] - az) ** 2;
    ref2 += ax * ax + ay * ay + az * az;
  }
  return Math.sqrt(err2 / Math.max(ref2, 1e-30));
}

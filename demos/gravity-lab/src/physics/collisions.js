const clock = () => globalThis.performance?.now() ?? Date.now();

/** Earliest sphere impact in a constant-velocity drift, without tunnelling. */
export function timeOfImpact(rx, ry, rz, vx, vy, vz, diameter, duration) {
  const c = rx * rx + ry * ry + rz * rz - diameter * diameter;
  const b = rx * vx + ry * vy + rz * vz;
  if (b >= -1e-13) return Infinity;
  const a = vx * vx + vy * vy + vz * vz;
  if (a < 1e-24) return Infinity;
  if (c <= diameter * diameter * 1e-11) return 0;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  // This equivalent root avoids subtracting two nearly equal large numbers.
  const t = c / (-b + Math.sqrt(disc));
  return t >= 0 && t <= duration + 1e-12 ? Math.max(0, Math.min(duration, t)) : Infinity;
}

export function sphereImpact(positions, velocities, i, j, diameter, restitution = 1) {
  const a = i * 3, b = j * 3;
  const x = positions[b] - positions[a], y = positions[b + 1] - positions[a + 1], z = positions[b + 2] - positions[a + 2];
  const d = Math.hypot(x, y, z);
  if (d === 0) return null;
  const nx = x / d, ny = y / d, nz = z / d;
  const normal = (velocities[b] - velocities[a]) * nx + (velocities[b + 1] - velocities[a + 1]) * ny + (velocities[b + 2] - velocities[a + 2]) * nz;
  if (normal >= 0) return null;
  const impulse = (1 + restitution) * normal * .5;
  velocities[a] += impulse * nx; velocities[a + 1] += impulse * ny; velocities[a + 2] += impulse * nz;
  velocities[b] -= impulse * nx; velocities[b + 1] -= impulse * ny; velocities[b + 2] -= impulse * nz;
  // Round-off repair only: impact positions are already at contact by CCD.
  if (Math.abs(d - diameter) < diameter * 1e-8) {
    const correction = (diameter - d) * .5;
    positions[a] -= correction * nx; positions[a + 1] -= correction * ny; positions[a + 2] -= correction * nz;
    positions[b] += correction * nx; positions[b + 1] += correction * ny; positions[b + 2] += correction * nz;
  }
  // Equal-mass kinetic energy lost, divided by the common mass.
  return { dissipation: .25 * (1 - restitution * restitution) * normal * normal };
}

/**
 * Repair an overlapping initial state before gravity integration starts.
 * Equal and opposite position changes preserve the centre of mass. Only an
 * approaching pair receives a contact impulse; separation adds no velocity.
 * Simultaneous multi-sphere contacts use a deterministic sequential solve.
 */
export function resolveInitialOverlaps(positions, velocities, count, radius, {
  restitution = 1,
  maxIterations = 256,
  maxResolutions = Math.max(4096, count * 256),
} = {}) {
  // Keep this below the CCD contact tolerance so a residual numerical overlap
  // cannot put the continuous solver beyond its accepted contact surface.
  const diameter = radius * 2, tolerance = diameter * 1e-12;
  const cells = new Map(), cellKeys = new Array(count);
  let events = 0, dissipation = 0, separatedPairs = 0, iterations = 0, resolutions = 0;
  const keyOf = (x, y, z) => `${x},${y},${z}`;
  // Match CCD's closing threshold; impulses below numerical resolution must
  // not keep an otherwise resolved initial contact in an endless loop.
  const approaching = (normal, distance) => distance === 0 ? normal < 0 : normal * distance < -1e-13;

  function updateCell(i) {
    const p = i * 3;
    const key = keyOf(Math.floor(positions[p] / diameter), Math.floor(positions[p + 1] / diameter), Math.floor(positions[p + 2] / diameter));
    if (cellKeys[i] === key) return;
    const old = cells.get(cellKeys[i]);
    if (old) { old.delete(i); if (!old.size) cells.delete(cellKeys[i]); }
    const cell = cells.get(key) ?? new Set();
    cell.add(i); cells.set(key, cell); cellKeys[i] = key;
  }

  function neighbours(i) {
    const p = i * 3;
    const x = Math.floor(positions[p] / diameter), y = Math.floor(positions[p + 1] / diameter), z = Math.floor(positions[p + 2] / diameter);
    const ids = [];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cell = cells.get(keyOf(x + dx, y + dy, z + dz));
      if (cell) for (const j of cell) if (j > i) ids.push(j);
    }
    return ids.sort((a, b) => a - b);
  }

  function inspectContacts() {
    let overlap = 0, pendingImpacts = 0;
    for (let i = 0; i < count; i++) for (const j of neighbours(i)) {
      const a = i * 3, b = j * 3;
      const x = positions[b] - positions[a], y = positions[b + 1] - positions[a + 1], z = positions[b + 2] - positions[a + 2];
      const distance = Math.hypot(x, y, z);
      overlap = Math.max(overlap, diameter - distance);
      if (distance > diameter) continue;
      const vx = velocities[b] - velocities[a], vy = velocities[b + 1] - velocities[a + 1], vz = velocities[b + 2] - velocities[a + 2];
      const [nx, ny, nz] = distance > 0 ? [x / distance, y / distance, z / distance] : coincidentNormal(i, j, vx, vy, vz);
      if (approaching(vx * nx + vy * ny + vz * nz, distance)) pendingImpacts++;
    }
    return { overlap, pendingImpacts };
  }

  function result() {
    const { overlap, pendingImpacts } = inspectContacts(), ok = overlap <= tolerance && pendingImpacts === 0;
    return { ok, events, dissipation, separatedPairs, iterations, maxOverlap: overlap, pendingImpacts, ...(ok ? {} : { reason: '初始接触过于密集，碰撞分离未收敛；请减小初始紧密度。' }) };
  }

  function coincidentNormal(i, j, vx, vy, vz) {
    const speed = Math.hypot(vx, vy, vz);
    // At identical centres there is no geometric normal. Relative motion gives
    // a reproducible approaching direction; otherwise derive one from the IDs.
    if (speed > 0) return [-vx / speed, -vy / speed, -vz / speed];
    function hash(value) {
      value ^= value >>> 16; value = Math.imul(value, 0x7feb352d);
      value ^= value >>> 15; value = Math.imul(value, 0x846ca68b);
      return (value ^ (value >>> 16)) >>> 0;
    }
    const seed = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(j + 1, 0x85ebca6b);
    const y = ((hash(seed) + .5) / 4294967296) * 2 - 1;
    const angle = ((hash(seed ^ 0x68e31da4) + .5) / 4294967296) * Math.PI * 2;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    return [horizontal * Math.cos(angle), y, horizontal * Math.sin(angle)];
  }

  for (let i = 0; i < count; i++) updateCell(i);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    iterations = iteration + 1;
    let corrections = 0, impulses = 0;
    for (let i = 0; i < count; i++) for (const j of neighbours(i)) {
      const a = i * 3, b = j * 3;
      const x = positions[b] - positions[a], y = positions[b + 1] - positions[a + 1], z = positions[b + 2] - positions[a + 2];
      const distance = Math.hypot(x, y, z);
      if (distance > diameter) continue;
      const vx = velocities[b] - velocities[a], vy = velocities[b + 1] - velocities[a + 1], vz = velocities[b + 2] - velocities[a + 2];
      const [nx, ny, nz] = distance > 0 ? [x / distance, y / distance, z / distance] : coincidentNormal(i, j, vx, vy, vz);
      const normal = vx * nx + vy * ny + vz * nz;
      const needsCorrection = diameter - distance > tolerance;
      const needsImpulse = approaching(normal, distance);
      if (!needsCorrection && !needsImpulse) continue;
      if (resolutions >= maxResolutions) return result();
      resolutions++;
      if (needsImpulse) {
        const impulse = (1 + restitution) * normal * .5;
        velocities[a] += impulse * nx; velocities[a + 1] += impulse * ny; velocities[a + 2] += impulse * nz;
        velocities[b] -= impulse * nx; velocities[b + 1] -= impulse * ny; velocities[b + 2] -= impulse * nz;
        dissipation += .25 * (1 - restitution * restitution) * normal * normal;
        events++; impulses++;
      }
      if (!needsCorrection) continue;
      const correction = (diameter - distance + tolerance) * .5;
      positions[a] -= correction * nx; positions[a + 1] -= correction * ny; positions[a + 2] -= correction * nz;
      positions[b] += correction * nx; positions[b + 1] += correction * ny; positions[b + 2] += correction * nz;
      updateCell(i); updateCell(j);
      separatedPairs++; corrections++;
    }
    // Separation can create contacts; another impulse can make a previously
    // visited contact approach again. Finish only when neither occurs.
    if (!corrections && !impulses) return result();
  }
  return result();
}

/** Reusable broad-phase storage and an indexed queue of pair impact times. */
export function createCollisionWorkspace(count = 0) {
  const workspace = {
    bodyCapacity: 0, cellCapacity: 0, pairCapacity: 0, heapCapacity: 0,
    cellGeneration: 0, eventGeneration: 0, cellCount: 0, heapSize: 0,
    links: new Int32Array(0), occupied: new Uint32Array(0),
    cellX: new Float64Array(0), cellY: new Float64Array(0), cellZ: new Float64Array(0),
    cellHead: new Int32Array(0), cellStamp: new Uint32Array(0),
    pairIndex: new Uint32Array(0), pairStamp: new Uint32Array(0),
    heapPair: new Uint32Array(0), heapTime: new Float64Array(0),
    // A binary-heap depth cannot reach this bound at supported particle counts.
    searchStack: new Uint32Array(64),
  };
  reserveBroadPhase(workspace, count);
  return workspace;
}

function reserveBroadPhase(workspace, count) {
  if (count <= workspace.bodyCapacity) return;
  let capacity = Math.max(16, workspace.bodyCapacity);
  while (capacity < count) capacity *= 2;
  workspace.bodyCapacity = capacity;
  workspace.links = new Int32Array(capacity);
  workspace.occupied = new Uint32Array(capacity);
  workspace.cellCapacity = capacity * 4;
  workspace.cellX = new Float64Array(workspace.cellCapacity);
  workspace.cellY = new Float64Array(workspace.cellCapacity);
  workspace.cellZ = new Float64Array(workspace.cellCapacity);
  workspace.cellHead = new Int32Array(workspace.cellCapacity);
  workspace.cellStamp = new Uint32Array(workspace.cellCapacity);
  workspace.cellGeneration = 0;
}

function reservePairQueue(workspace, count) {
  if (count * count <= workspace.pairCapacity) return;
  // Pair IDs are i * count + j, with i < j. Generation stamps avoid clearing
  // this index on every drift, including the many trials with no collisions.
  workspace.pairCapacity = workspace.bodyCapacity * workspace.bodyCapacity;
  workspace.pairIndex = new Uint32Array(workspace.pairCapacity);
  workspace.pairStamp = new Uint32Array(workspace.pairCapacity);
}

function reserveHeap(workspace) {
  if (workspace.heapSize < workspace.heapCapacity) return;
  workspace.heapCapacity = Math.max(64, workspace.heapCapacity * 2);
  const pair = new Uint32Array(workspace.heapCapacity), time = new Float64Array(workspace.heapCapacity);
  pair.set(workspace.heapPair); time.set(workspace.heapTime);
  workspace.heapPair = pair; workspace.heapTime = time;
}

function resetCollisionWorkspace(workspace, count) {
  reserveBroadPhase(workspace, count);
  workspace.cellCount = 0; workspace.heapSize = 0;
  workspace.cellGeneration = (workspace.cellGeneration + 1) >>> 0;
  if (workspace.cellGeneration === 0) { workspace.cellStamp.fill(0); workspace.cellGeneration = 1; }
  workspace.eventGeneration = (workspace.eventGeneration + 1) >>> 0;
  if (workspace.eventGeneration === 0) { workspace.pairStamp.fill(0); workspace.eventGeneration = 1; }
}

function cellSlot(workspace, x, y, z, insert = false) {
  const mask = workspace.cellCapacity - 1;
  let slot = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
  while (workspace.cellStamp[slot] === workspace.cellGeneration) {
    if (workspace.cellX[slot] === x && workspace.cellY[slot] === y && workspace.cellZ[slot] === z) return slot;
    slot = (slot + 1) & mask;
  }
  if (!insert) return -1;
  workspace.cellStamp[slot] = workspace.cellGeneration;
  workspace.cellX[slot] = x; workspace.cellY[slot] = y; workspace.cellZ[slot] = z;
  workspace.cellHead[slot] = -1;
  workspace.occupied[workspace.cellCount++] = slot;
  return slot;
}

function eventBefore(workspace, a, b) {
  return workspace.heapTime[a] < workspace.heapTime[b] ||
    (workspace.heapTime[a] === workspace.heapTime[b] && workspace.heapPair[a] < workspace.heapPair[b]);
}

function swapEvents(workspace, a, b) {
  const pair = workspace.heapPair[a], time = workspace.heapTime[a];
  workspace.heapPair[a] = workspace.heapPair[b]; workspace.heapTime[a] = workspace.heapTime[b];
  workspace.heapPair[b] = pair; workspace.heapTime[b] = time;
  workspace.pairIndex[workspace.heapPair[a]] = a;
  workspace.pairIndex[pair] = b;
}

function siftEventUp(workspace, index) {
  while (index > 0) {
    const parent = (index - 1) >>> 1;
    if (!eventBefore(workspace, index, parent)) break;
    swapEvents(workspace, index, parent); index = parent;
  }
}

function siftEventDown(workspace, index) {
  while (true) {
    const left = index * 2 + 1;
    if (left >= workspace.heapSize) return;
    const right = left + 1;
    const first = right < workspace.heapSize && eventBefore(workspace, right, left) ? right : left;
    if (!eventBefore(workspace, first, index)) return;
    swapEvents(workspace, first, index); index = first;
  }
}

function queueImpact(workspace, pair, time, count) {
  const active = workspace.pairStamp[pair] === workspace.eventGeneration;
  if (!Number.isFinite(time)) {
    if (!active) return;
    const index = workspace.pairIndex[pair];
    workspace.pairStamp[pair] = 0;
    const last = --workspace.heapSize;
    if (index === last) return;
    workspace.heapPair[index] = workspace.heapPair[last]; workspace.heapTime[index] = workspace.heapTime[last];
    workspace.pairIndex[workspace.heapPair[index]] = index;
    if (index > 0 && eventBefore(workspace, index, (index - 1) >>> 1)) siftEventUp(workspace, index);
    else siftEventDown(workspace, index);
    return;
  }
  if (active) {
    const index = workspace.pairIndex[pair], previous = workspace.heapTime[index];
    workspace.heapTime[index] = time;
    if (time < previous) siftEventUp(workspace, index);
    else siftEventDown(workspace, index);
    return;
  }
  reservePairQueue(workspace, count); reserveHeap(workspace);
  const index = workspace.heapSize++;
  workspace.heapPair[index] = pair; workspace.heapTime[index] = time;
  workspace.pairStamp[pair] = workspace.eventGeneration; workspace.pairIndex[pair] = index;
  siftEventUp(workspace, index);
}

function pairImpactTime(positions, velocities, i, j, diameter, duration) {
  const a = i * 3, b = j * 3;
  const rx = positions[b] - positions[a], ry = positions[b + 1] - positions[a + 1], rz = positions[b + 2] - positions[a + 2];
  const vx = velocities[b] - velocities[a], vy = velocities[b + 1] - velocities[a + 1], vz = velocities[b + 2] - velocities[a + 2];
  // Cheap swept-axis rejection for the local updates, which deliberately
  // inspect every other particle after either participant changes velocity.
  // Include the narrow phase's contact and end-of-drift time tolerances.
  const reach = diameter * (1 + 1e-10), horizon = duration + 1e-12;
  if (Math.abs(rx) > reach + Math.abs(vx) * horizon ||
      Math.abs(ry) > reach + Math.abs(vy) * horizon ||
      Math.abs(rz) > reach + Math.abs(vz) * horizon) return Infinity;
  return timeOfImpact(rx, ry, rz, vx, vy, vz, diameter, duration);
}

function buildImpactQueue(positions, velocities, count, diameter, duration, workspace, probeOnly) {
  let maxSpeedSquared = 0, minX = Infinity, minY = Infinity, minZ = Infinity;
  for (let i = 0; i < count; i++) {
    const p = i * 3;
    maxSpeedSquared = Math.max(maxSpeedSquared, velocities[p] ** 2 + velocities[p + 1] ** 2 + velocities[p + 2] ** 2);
    minX = Math.min(minX, positions[p]); minY = Math.min(minY, positions[p + 1]); minZ = Math.min(minZ, positions[p + 2]);
  }
  // Any pair able to meet in this drift begins within this distance. Thus the
  // 27 adjacent cells form a conservative swept broad phase, even in free space.
  const cellSize = diameter + 2 * Math.sqrt(maxSpeedSquared) * duration + diameter * 1e-10;
  const links = workspace.links;
  for (let i = 0; i < count; i++) {
    const p = i * 3;
    const x = Math.floor((positions[p] - minX) / cellSize) + 1;
    const y = Math.floor((positions[p + 1] - minY) / cellSize) + 1;
    const z = Math.floor((positions[p + 2] - minZ) / cellSize) + 1;
    const slot = cellSlot(workspace, x, y, z, true);
    links[i] = workspace.cellHead[slot]; workspace.cellHead[slot] = i;
  }
  let best = Infinity, first = -1, second = -1;
  function consider(i, j) {
    const lo = Math.min(i, j), hi = Math.max(i, j);
    const t = pairImpactTime(positions, velocities, lo, hi, diameter, duration);
    if (!Number.isFinite(t)) return;
    if (!probeOnly) queueImpact(workspace, lo * count + hi, t, count);
    if (t < best - 1e-12 || (Math.abs(t - best) <= 1e-12 && (lo < first || (lo === first && hi < second)))) {
      best = t; first = lo; second = hi;
    }
  }
  for (let c = 0; c < workspace.cellCount; c++) {
    const slot = workspace.occupied[c], head = workspace.cellHead[slot];
    const x = workspace.cellX[slot], y = workspace.cellY[slot], z = workspace.cellZ[slot];
    for (let i = head; i >= 0; i = links[i]) for (let j = links[i]; j >= 0; j = links[j]) consider(i, j);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dz < 0 || (dz === 0 && dy < 0) || (dz === 0 && dy === 0 && dx <= 0)) continue;
      const other = cellSlot(workspace, x + dx, y + dy, z + dz);
      if (other < 0) continue;
      for (let i = head; i >= 0; i = links[i]) for (let j = workspace.cellHead[other]; j >= 0; j = links[j]) consider(i, j);
    }
  }
  return { time: best, i: first, j: second };
}

function earliestQueuedImpact(workspace, count, elapsed) {
  if (workspace.heapSize === 0) return { time: Infinity, i: -1, j: -1 };
  // Tolerance-based heap comparators are not transitive. Keep the heap ordered
  // by exact time, then explicitly choose the lowest IDs in the simultaneous
  // event window, preserving the CCD solver's 1e-12 tie convention.
  const cutoff = workspace.heapTime[0] + 1e-12, stack = workspace.searchStack;
  let selected = 0, top = 1;
  stack[0] = 0;
  while (top > 0) {
    const index = stack[--top];
    if (workspace.heapPair[index] < workspace.heapPair[selected]) selected = index;
    const left = index * 2 + 1, right = left + 1;
    if (left < workspace.heapSize && workspace.heapTime[left] <= cutoff) stack[top++] = left;
    if (right < workspace.heapSize && workspace.heapTime[right] <= cutoff) stack[top++] = right;
  }
  const pair = workspace.heapPair[selected], i = Math.floor(pair / count);
  return { time: Math.max(0, workspace.heapTime[selected] - elapsed), i, j: pair - i * count };
}

function updateParticipantImpacts(positions, velocities, count, diameter, remaining, elapsed, i, j, workspace) {
  // All other trajectories are unchanged during this constant-velocity drift,
  // so their absolute impact times stay valid. Checking both participants
  // against every body also discovers partners after arbitrary ricochets;
  // it does not rely on the initial hash or on an unchanged maximum speed.
  for (let k = 0; k < count; k++) {
    if (k !== i) {
      const lo = Math.min(i, k), hi = Math.max(i, k);
      queueImpact(workspace, lo * count + hi, elapsed + pairImpactTime(positions, velocities, lo, hi, diameter, remaining), count);
    }
    if (k !== j && k !== i) {
      const lo = Math.min(j, k), hi = Math.max(j, k);
      queueImpact(workspace, lo * count + hi, elapsed + pairImpactTime(positions, velocities, lo, hi, diameter, remaining), count);
    }
  }
}

function drift(positions, velocities, duration) {
  for (let p = 0; p < positions.length; p++) positions[p] += velocities[p] * duration;
}

let fallbackWorkspace;
/** Atomic caller must roll back on failure; no drift time is silently skipped. */
export function continuousDrift(positions, velocities, count, radius, duration, { restitution = 1, maxEvents = Math.max(128, count * 4), maxMs = 50, contactDt = Infinity, workspace = null } = {}) {
  let remaining = duration, events = 0, dissipation = 0, firstImpactTime = Infinity;
  const started = clock();
  if (remaining <= 1e-14) return { ok: true, events, dissipation, firstImpactTime };
  const scratch = workspace ?? (fallbackWorkspace ??= createCollisionWorkspace(count));
  resetCollisionWorkspace(scratch, count);
  const probeOnly = duration > contactDt * 1.001;
  const first = buildImpactQueue(positions, velocities, count, radius * 2, duration, scratch, probeOnly);
  if (!Number.isFinite(first.time)) { drift(positions, velocities, remaining); return { ok: true, events, dissipation, firstImpactTime }; }
  // A gravity-aware caller can reject this trial before building its queue.
  // Refinement changes integration accuracy, not restitution.
  if (probeOnly) return { ok: false, refine: true, events: 0, firstImpactTime: first.time };
  while (remaining > 1e-14) {
    const elapsed = duration - remaining;
    const hit = earliestQueuedImpact(scratch, count, elapsed);
    if (!Number.isFinite(hit.time)) { drift(positions, velocities, remaining); return { ok: true, events, dissipation, firstImpactTime }; }
    if (events >= maxEvents || (events > 0 && clock() - started > maxMs)) return { ok: false, events, reason: '密集碰撞：缩短时间步' };
    const driftTime = Math.min(remaining, hit.time);
    drift(positions, velocities, driftTime);
    remaining -= driftTime;
    if (events === 0) firstImpactTime = duration - remaining;
    const impact = sphereImpact(positions, velocities, hit.i, hit.j, radius * 2, restitution);
    if (!impact) return { ok: false, events, reason: '接触求解未收敛' };
    dissipation += impact.dissipation;
    events++;
    if (remaining > 1e-14) updateParticipantImpacts(positions, velocities, count, radius * 2, remaining, duration - remaining, hit.i, hit.j, scratch);
  }
  return { ok: true, events, dissipation, firstImpactTime };
}

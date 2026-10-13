const clock = () => globalThis.performance?.now() ?? Date.now();
// Keep the fast dense index bounded to 32 MiB; larger systems index only
// queued impacts instead of allocating arrays for every possible pair.
const MAX_DENSE_PARTICLES = 2048;
const MAX_QUEUED_PAIRS = 262144;

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
  if (!(d > 0) || !Number.isFinite(d) || Math.abs(d - diameter) > diameter * 1e-8) return null;
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

/** Reusable broad-phase storage and an indexed queue of pair impact times. */
export function createCollisionWorkspace(count = 0) {
  const workspace = {
    bodyCapacity: 0, cellCapacity: 0, pairCapacity: 0, heapCapacity: 0,
    cellGeneration: 0, eventGeneration: 0, cellCount: 0, heapSize: 0,
    links: new Int32Array(0), occupied: new Uint32Array(0),
    cellX: new Float64Array(0), cellY: new Float64Array(0), cellZ: new Float64Array(0),
    cellHead: new Int32Array(0), cellStamp: new Uint32Array(0),
    pairIndex: new Uint32Array(0), pairStamp: new Uint32Array(0),
    sparsePairIndex: null, streaming: false,
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
  if (workspace.sparsePairIndex || count * count <= workspace.pairCapacity) return;
  // Pair IDs are i * count + j, with i < j. Generation stamps avoid clearing
  // this index on every drift, including the many trials with no collisions.
  workspace.pairCapacity = 2 ** (2 * Math.ceil(Math.log2(count)));
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
  if (count > MAX_DENSE_PARTICLES) {
    workspace.sparsePairIndex ??= new Map();
    workspace.sparsePairIndex.clear();
    if (workspace.pairCapacity) {
      workspace.pairCapacity = 0;
      workspace.pairIndex = new Uint32Array(0);
      workspace.pairStamp = new Uint32Array(0);
    }
  } else workspace.sparsePairIndex = null;
  workspace.cellCount = 0; workspace.heapSize = 0; workspace.streaming = false;
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

function queuedIndex(workspace, pair) {
  if (workspace.sparsePairIndex) return workspace.sparsePairIndex.get(pair);
  return workspace.pairStamp[pair] === workspace.eventGeneration ? workspace.pairIndex[pair] : undefined;
}

function setQueuedIndex(workspace, pair, index) {
  if (workspace.sparsePairIndex) workspace.sparsePairIndex.set(pair, index);
  else {
    workspace.pairStamp[pair] = workspace.eventGeneration;
    workspace.pairIndex[pair] = index;
  }
}

function swapEvents(workspace, a, b) {
  const pair = workspace.heapPair[a], time = workspace.heapTime[a];
  workspace.heapPair[a] = workspace.heapPair[b]; workspace.heapTime[a] = workspace.heapTime[b];
  workspace.heapPair[b] = pair; workspace.heapTime[b] = time;
  setQueuedIndex(workspace, workspace.heapPair[a], a);
  setQueuedIndex(workspace, pair, b);
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
  if (workspace.streaming) return;
  const queued = queuedIndex(workspace, pair);
  if (!Number.isFinite(time)) {
    if (queued === undefined) return;
    const index = queued;
    if (workspace.sparsePairIndex) workspace.sparsePairIndex.delete(pair);
    else workspace.pairStamp[pair] = 0;
    const last = --workspace.heapSize;
    if (index === last) return;
    workspace.heapPair[index] = workspace.heapPair[last]; workspace.heapTime[index] = workspace.heapTime[last];
    setQueuedIndex(workspace, workspace.heapPair[index], index);
    if (index > 0 && eventBefore(workspace, index, (index - 1) >>> 1)) siftEventUp(workspace, index);
    else siftEventDown(workspace, index);
    return;
  }
  if (queued !== undefined) {
    const index = queued, previous = workspace.heapTime[index];
    workspace.heapTime[index] = time;
    if (time < previous) siftEventUp(workspace, index);
    else siftEventDown(workspace, index);
    return;
  }
  if (workspace.heapSize >= MAX_QUEUED_PAIRS) {
    // Switch this trial to streaming TOI reduction; no candidate is dropped.
    workspace.streaming = true;
    workspace.heapSize = 0;
    workspace.sparsePairIndex?.clear();
    return;
  }
  reservePairQueue(workspace, count); reserveHeap(workspace);
  const index = workspace.heapSize++;
  workspace.heapPair[index] = pair; workspace.heapTime[index] = time;
  setQueuedIndex(workspace, pair, index);
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

function buildSweptCells(positions, velocities, count, diameter, duration, workspace) {
  let maxSpeed = 0, minX = Infinity, minY = Infinity, minZ = Infinity;
  for (let i = 0; i < count; i++) {
    const p = i * 3;
    maxSpeed = Math.max(maxSpeed, Math.hypot(velocities[p], velocities[p + 1], velocities[p + 2]));
    minX = Math.min(minX, positions[p]); minY = Math.min(minY, positions[p + 1]); minZ = Math.min(minZ, positions[p + 2]);
  }
  // Any pair meeting within this drift starts in the same or adjacent cell.
  const cellSize = diameter + 2 * maxSpeed * duration + diameter * 1e-10;
  if (!Number.isFinite(cellSize)) { workspace.streaming = true; return; }
  for (let i = 0; i < count; i++) {
    const p = i * 3;
    const x = Math.floor((positions[p] - minX) / cellSize) + 1;
    const y = Math.floor((positions[p + 1] - minY) / cellSize) + 1;
    const z = Math.floor((positions[p + 2] - minZ) / cellSize) + 1;
    // Adjacent integer cells cannot be represented outside this range.
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Number.isSafeInteger(z)) { workspace.streaming = true; return; }
    const slot = cellSlot(workspace, x, y, z, true);
    workspace.links[i] = workspace.cellHead[slot]; workspace.cellHead[slot] = i;
  }
}

function* candidatePairs(workspace, count) {
  const links = workspace.links;
  const pair = (i, j) => Math.min(i, j) * count + Math.max(i, j);
  for (let c = 0; c < workspace.cellCount; c++) {
    const slot = workspace.occupied[c], head = workspace.cellHead[slot];
    const x = workspace.cellX[slot], y = workspace.cellY[slot], z = workspace.cellZ[slot];
    for (let i = head; i >= 0; i = links[i]) for (let j = links[i]; j >= 0; j = links[j]) yield pair(i, j);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dz < 0 || (dz === 0 && dy < 0) || (dz === 0 && dy === 0 && dx <= 0)) continue;
      const other = cellSlot(workspace, x + dx, y + dy, z + dz);
      if (other < 0) continue;
      for (let i = head; i >= 0; i = links[i]) for (let j = workspace.cellHead[other]; j >= 0; j = links[j]) yield pair(i, j);
    }
    // Sparse scenes also yield while walking empty neighbouring cells.
    yield -1;
  }
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

function drift(positions, velocities, duration) {
  for (let p = 0; p < positions.length; p++) positions[p] += velocities[p] * duration;
}

function startStreamingScan(state) {
  state.phase = 'scan'; state.scanI = 0; state.scanJ = 1;
  state.minimumTime = Infinity; state.selectingTie = false;
}

/** A resumable trial. Its arrays must be private until the caller commits KDK. */
export function createContinuousDrift(positions, velocities, count, radius, duration, {
  restitution = 1, maxEvents = Math.max(128, count * 4), workspace = createCollisionWorkspace(count),
} = {}) {
  resetCollisionWorkspace(workspace, count);
  const state = { positions, velocities, count, diameter: radius * 2, duration,
    restitution, maxEvents, workspace, elapsed: 0, events: 0, dissipation: 0,
    phase: 'build', iterator: null, done: false, ok: true };
  buildSweptCells(positions, velocities, count, state.diameter, duration, workspace);
  if (workspace.streaming) startStreamingScan(state);
  else state.iterator = candidatePairs(workspace, count);
  return state;
}

function processImpact(state, hit) {
  const remaining = Math.max(0, state.duration - state.elapsed);
  if (!Number.isFinite(hit.time)) {
    drift(state.positions, state.velocities, remaining);
    state.elapsed = state.duration; state.done = true;
    return;
  }
  if (state.events >= state.maxEvents) {
    state.done = true; state.ok = false;
    state.reason = '固定时间步内的碰撞次数达到上限，已回滚并暂停。';
    return;
  }
  const driftTime = Math.min(remaining, Math.max(0, hit.time));
  drift(state.positions, state.velocities, driftTime);
  state.elapsed = Math.min(state.duration, state.elapsed + driftTime);
  const impact = sphereImpact(state.positions, state.velocities, hit.i, hit.j, state.diameter, state.restitution);
  if (!impact || !Number.isFinite(impact.dissipation)) {
    state.done = true; state.ok = false;
    state.reason = '连续接触求解失败，已回滚固定时间步并暂停。';
    return;
  }
  state.events++; state.dissipation += impact.dissipation;
  // Even at the exact endpoint, finish all newly approaching zero-time
  // contacts before committing; an impulse can create another simultaneous hit.
  state.lastI = hit.i; state.lastJ = hit.j; state.participantIndex = 0;
  if (state.workspace.streaming) startStreamingScan(state);
  else state.phase = 'participants';
}

/** A wall-clock deadline yields without changing the fixed physical duration. */
export function continueContinuousDrift(state, deadline = Infinity) {
  const { positions, velocities, count, diameter, workspace } = state;
  let work = 0;
  while (!state.done) {
    if ((work++ & 255) === 0 && clock() >= deadline) break;
    const remaining = Math.max(0, state.duration - state.elapsed);
    if (state.phase === 'build') {
      const next = state.iterator.next();
      if (next.done) { state.iterator = null; state.phase = 'event'; continue; }
      if (next.value < 0) continue;
      const i = Math.floor(next.value / count), j = next.value - i * count;
      queueImpact(workspace, next.value, pairImpactTime(positions, velocities, i, j, diameter, remaining), count);
      if (workspace.streaming) { state.iterator = null; startStreamingScan(state); }
    } else if (state.phase === 'participants') {
      const k = state.participantIndex++;
      if (k >= count) { state.phase = 'event'; continue; }
      const { lastI: i, lastJ: j } = state;
      if (k !== i) {
        const lo = Math.min(i, k), hi = Math.max(i, k);
        queueImpact(workspace, lo * count + hi, state.elapsed + pairImpactTime(positions, velocities, lo, hi, diameter, remaining), count);
      }
      if (k !== j && k !== i) {
        const lo = Math.min(j, k), hi = Math.max(j, k);
        queueImpact(workspace, lo * count + hi, state.elapsed + pairImpactTime(positions, velocities, lo, hi, diameter, remaining), count);
      }
      if (workspace.streaming) startStreamingScan(state);
    } else if (state.phase === 'scan') {
      const i = state.scanI, j = state.scanJ;
      if (i >= count - 1) {
        if (!Number.isFinite(state.minimumTime)) processImpact(state, { time: Infinity });
        else if (!state.selectingTie) {
          // A second bounded-memory pass selects the lowest pair ID within
          // the exact minimum's tie window; approximate heap ordering is unsafe.
          state.selectingTie = true; state.scanI = 0; state.scanJ = 1;
        } else {
          state.done = true; state.ok = false; state.reason = '接触时间归约不一致，已暂停。';
        }
        continue;
      }
      const time = pairImpactTime(positions, velocities, i, j, diameter, remaining);
      if (state.selectingTie && Number.isFinite(time) && time <= state.minimumTime + 1e-12) {
        processImpact(state, { time, i, j });
        continue;
      }
      if (!state.selectingTie) state.minimumTime = Math.min(state.minimumTime, time);
      state.scanJ++;
      if (state.scanJ >= count) { state.scanI++; state.scanJ = state.scanI + 1; }
    } else {
      processImpact(state, earliestQueuedImpact(workspace, count, state.elapsed));
    }
  }
  return { done: state.done, ok: state.ok, events: state.events, dissipation: state.dissipation, reason: state.reason };
}

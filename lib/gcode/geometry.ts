import {
  STRIDE,
  MAX_SEGMENTS,
  GEOMETRY_LIMIT_MESSAGE,
  type GcodeModel,
  type Layer,
  type MeshBatch,
  type ParsedGcode,
  type ViewRange,
} from './types';

/** Store compact instances; the GPU expands the shared extrusion cross section. */
export function buildGeometry(
  parsed: ParsedGcode,
  onProgress: (value: number) => void = () => {},
): GcodeModel {
  if (parsed.segmentCount > MAX_SEGMENTS)
    throw new Error(GEOMETRY_LIMIT_MESSAGE);
  const batches: MeshBatch[] = [];
  const byRole = new Map<number, MeshBatch>();
  parsed.roleCounts.forEach((count, role) => {
    if (!count) return;
    const batch: MeshBatch = {
      role,
      instances: new Float32Array(count * 8),
      moveIds: new Uint32Array(count),
    };
    batches.push(batch);
    byRole.set(role, batch);
  });
  const offsets = parsed.roleCounts.map(() => 0);
  const s = parsed.segments;
  for (let index = 0; index < parsed.segmentCount; index++) {
    const offset = index * STRIDE;
    const role = s[offset + 8],
      batch = byRole.get(role)!;
    const localIndex = offsets[role]++;
    batch.instances.set(s.subarray(offset, offset + 8), localIndex * 8);
    batch.moveIds[localIndex] = s[offset + 9];
    if (index % 4096 === 0) onProgress(index / parsed.segmentCount);
  }
  const { segments: _segments, ...metadata } = parsed;
  onProgress(1);
  return { ...metadata, batches };
}

function lowerBound(ids: Uint32Array, value: number) {
  let low = 0,
    high = ids.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ids[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function drawRanges(
  batch: Pick<MeshBatch, 'moveIds' | 'role'>,
  layers: Layer[],
  range: ViewRange,
) {
  const empty = { colored: [0, 0], muted: [0, 0] };
  if (!range.visible[batch.role] || !layers[range.low] || !layers[range.high])
    return empty;
  const bottom = lowerBound(batch.moveIds, layers[range.low].startMove);
  const end = lowerBound(batch.moveIds, range.move + 1);
  const stepping = range.move < layers[range.high].endMove;
  const top = stepping
    ? lowerBound(batch.moveIds, layers[range.high].startMove)
    : bottom;
  return {
    colored: [top, Math.max(0, end - top)],
    muted: [bottom, Math.max(0, top - bottom)],
  };
}

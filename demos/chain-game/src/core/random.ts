/** State is serialized with each run. Streams are never shared with UI code. */
export function nextRandom(state: number): { state: number; value: number } {
  let next = state >>> 0 || 0x6d2b79f5;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return { state: next >>> 0, value: (next >>> 0) / 0x100000000 };
}

export function seedStreams(seed: number) {
  return {
    board: (seed ^ 0x9e3779b9) >>> 0 || 1,
    rage: (seed ^ 0x85ebca6b) >>> 0 || 2,
    rewards: (seed ^ 0xc2b2ae35) >>> 0 || 3,
  };
}

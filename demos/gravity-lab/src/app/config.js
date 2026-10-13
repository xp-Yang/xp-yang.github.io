/** Initial settings are drafts until Apply; runtime owns the applied copy. */
export const DEFAULT_INITIAL = Object.freeze({
  count: 384,
  packing: 0.025,
  virial: 0,
  seed: 42,
  distribution: 'symmetric-shell',
  G: 1,
  restitution: 1,
  collisionless: true,
  softeningRatio: 1,
  forceBackend: 'webgpu',
});

export const DISTRIBUTIONS = [
  ['uniform', '均匀球云'],
  ['shell', '均匀球壳'],
  ['disk', '均匀圆盘'],
  ['symmetric-shell', '对称球壳'],
  ['ring', '对称圆环'],
];

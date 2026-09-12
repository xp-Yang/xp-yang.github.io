export type BlackHoleCameraMode = 'free' | 'orbit' | 'fixed';
export type BlackHoleQuality = 'auto' | 'high' | 'balanced' | 'safe';

export interface BlackHoleControls {
  azimuth: number;
  inclination: number;
  observerRadius: number;
  zoom: number;
  cameraMode: BlackHoleCameraMode;
  blackHoleMassSolar: number;
  eddingtonRatio: number;
  diskOuterRadius: number;
  observerMotion: boolean;
  quality: BlackHoleQuality;
  exposure: number;
  bloom: number;
  starsEnabled: boolean;
  performanceInfo: boolean;
}

export const DEFAULT_BLACK_HOLE_CONTROLS: BlackHoleControls = {
  azimuth: 0,
  inclination: 12,
  observerRadius: 28,
  zoom: 1,
  cameraMode: 'orbit',
  blackHoleMassSolar: 100_000_000,
  eddingtonRatio: 0.1,
  diskOuterRadius: 24,
  observerMotion: true,
  quality: 'auto',
  exposure: 0.75,
  bloom: 0.28,
  starsEnabled: true,
  performanceInfo: false,
};

export function clampBlackHoleControls(
  controls: BlackHoleControls,
): BlackHoleControls {
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(maximum, Math.max(minimum, value));

  return {
    ...controls,
    azimuth: clamp(controls.azimuth, -180, 180),
    inclination: clamp(controls.inclination, 0, 85),
    observerRadius: clamp(controls.observerRadius, 10, 80),
    zoom: clamp(controls.zoom, 0.5, 2.4),
    blackHoleMassSolar: clamp(
      controls.blackHoleMassSolar,
      1_000_000,
      10_000_000_000,
    ),
    eddingtonRatio: clamp(controls.eddingtonRatio, 0.01, 1),
    diskOuterRadius: clamp(controls.diskOuterRadius, 12, 48),
    exposure: clamp(controls.exposure, 0.25, 1.5),
    bloom: clamp(controls.bloom, 0, 0.7),
  };
}

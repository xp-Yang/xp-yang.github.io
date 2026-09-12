export const SCHWARZSCHILD = {
  mass: 1,
  horizonRadius: 2,
  photonSphereRadius: 3,
  iscoRadius: 6,
  diskOuterRadius: 24,
  observerRadius: 28,
} as const;

export const ASTROPHYSICAL_PRESET = {
  blackHoleMassSolar: 100_000_000,
  eddingtonRatio: 0.1,
} as const;

export const BLACKBODY_TEMPERATURE_MIN = 1_000;
export const BLACKBODY_TEMPERATURE_MAX = 160_000;

export interface OrbitState {
  u: number;
  du: number;
}

export interface ImpactTrace {
  captured: boolean;
  escaped: boolean;
  phi: number;
  minRadius: number;
  steps: number;
  invariantDrift: number;
}

export function geodesicAcceleration(
  u: number,
  mass: number = SCHWARZSCHILD.mass,
) {
  return -u + 3 * mass * u * u;
}

export function rk4OrbitStep(
  state: OrbitState,
  deltaPhi: number,
  mass: number = SCHWARZSCHILD.mass,
): OrbitState {
  const derivative = ({ u, du }: OrbitState): OrbitState => ({
    u: du,
    du: geodesicAcceleration(u, mass),
  });
  const add = (
    base: OrbitState,
    slope: OrbitState,
    scale: number,
  ): OrbitState => ({
    u: base.u + slope.u * scale,
    du: base.du + slope.du * scale,
  });

  const k1 = derivative(state);
  const k2 = derivative(add(state, k1, deltaPhi * 0.5));
  const k3 = derivative(add(state, k2, deltaPhi * 0.5));
  const k4 = derivative(add(state, k3, deltaPhi));

  return {
    u: state.u + (deltaPhi / 6) * (k1.u + 2 * k2.u + 2 * k3.u + k4.u),
    du: state.du + (deltaPhi / 6) * (k1.du + 2 * k2.du + 2 * k3.du + k4.du),
  };
}

export function orbitInvariant(
  state: OrbitState,
  mass: number = SCHWARZSCHILD.mass,
) {
  return (
    state.du * state.du +
    state.u * state.u -
    2 * mass * state.u * state.u * state.u
  );
}

export function criticalImpactParameter(mass: number = SCHWARZSCHILD.mass) {
  return 3 * Math.sqrt(3) * mass;
}

export function traceImpactParameter(
  impactParameter: number,
  {
    mass = SCHWARZSCHILD.mass,
    startRadius = 1_000,
    deltaPhi = 0.0025,
    maxSteps = 12_000,
  }: {
    mass?: number;
    startRadius?: number;
    deltaPhi?: number;
    maxSteps?: number;
  } = {},
): ImpactTrace {
  const startU = 1 / startRadius;
  const invariant = 1 / (impactParameter * impactParameter);
  const radialTerm =
    invariant - startU * startU + 2 * mass * startU * startU * startU;
  let state: OrbitState = { u: startU, du: Math.sqrt(Math.max(radialTerm, 0)) };
  let phi = 0;
  let minRadius = startRadius;
  let maxDrift = 0;

  for (let steps = 1; steps <= maxSteps; steps += 1) {
    state = rk4OrbitStep(state, deltaPhi, mass);
    phi += deltaPhi;
    if (!Number.isFinite(state.u) || !Number.isFinite(state.du)) {
      return {
        captured: true,
        escaped: false,
        phi,
        minRadius,
        steps,
        invariantDrift: Number.POSITIVE_INFINITY,
      };
    }

    const radius = state.u > 0 ? 1 / state.u : Number.POSITIVE_INFINITY;
    minRadius = Math.min(minRadius, radius);
    maxDrift = Math.max(
      maxDrift,
      Math.abs(orbitInvariant(state, mass) - invariant),
    );

    if (radius <= 2 * mass) {
      return {
        captured: true,
        escaped: false,
        phi,
        minRadius,
        steps,
        invariantDrift: maxDrift,
      };
    }
    if (state.u <= startU && state.du < 0 && phi > Math.PI * 0.5) {
      return {
        captured: false,
        escaped: true,
        phi,
        minRadius,
        steps,
        invariantDrift: maxDrift,
      };
    }
  }

  return {
    captured: false,
    escaped: false,
    phi,
    minRadius,
    steps: maxSteps,
    invariantDrift: maxDrift,
  };
}

/** Page-Thorne flux shape for a zero-torque Schwarzschild thin disk (G = c = M = 1). */
export function novikovThorneFlux(radius: number) {
  const inner = SCHWARZSCHILD.iscoRadius;
  if (radius <= inner) return 0;

  const x = Math.sqrt(radius);
  const x0 = Math.sqrt(inner);
  const root3 = Math.sqrt(3);
  const logArgument =
    ((x - root3) * (x0 + root3)) / ((x + root3) * (x0 - root3));
  const integral = x - x0 - (root3 / 2) * Math.log(logArgument);
  return Math.max(0, (Math.pow(radius, -2.5) * integral) / (radius - 3));
}

export function findThinDiskPeak(samples = 2048) {
  let peakRadius: number = SCHWARZSCHILD.iscoRadius;
  let peakFlux = 0;
  for (let index = 1; index <= samples; index += 1) {
    const radius =
      SCHWARZSCHILD.iscoRadius +
      ((SCHWARZSCHILD.diskOuterRadius - SCHWARZSCHILD.iscoRadius) * index) /
        samples;
    const flux = novikovThorneFlux(radius);
    if (flux > peakFlux) {
      peakFlux = flux;
      peakRadius = radius;
    }
  }
  return { radius: peakRadius, flux: peakFlux };
}

export function thinDiskPeakTemperatureKelvin(
  blackHoleMassSolar: number = ASTROPHYSICAL_PRESET.blackHoleMassSolar,
  eddingtonRatio: number = ASTROPHYSICAL_PRESET.eddingtonRatio,
) {
  const gravitationalConstant = 6.6743e-11;
  const speedOfLight = 299_792_458;
  const stefanBoltzmann = 5.670374419e-8;
  const solarMassKg = 1.98847e30;
  const schwarzschildEfficiency = 1 - Math.sqrt(8 / 9);
  const massKg = blackHoleMassSolar * solarMassKg;
  const eddingtonLuminosity = 1.26e31 * blackHoleMassSolar;
  const accretionRateKgPerSecond =
    (eddingtonRatio * eddingtonLuminosity) /
    (schwarzschildEfficiency * speedOfLight * speedOfLight);
  const peak = findThinDiskPeak();
  const physicalFlux =
    (accretionRateKgPerSecond *
      Math.pow(speedOfLight, 6) *
      (3 / (8 * Math.PI)) *
      peak.flux) /
    (gravitationalConstant * gravitationalConstant * massKg * massKg);
  return Math.pow(physicalFlux / stefanBoltzmann, 0.25);
}

export function circularOrbitSpeed(
  radius: number,
  mass: number = SCHWARZSCHILD.mass,
) {
  if (radius <= 2 * mass) return Number.POSITIVE_INFINITY;
  return Math.sqrt(mass / (radius - 2 * mass));
}

export function diskRedshiftFactor({
  radius,
  photonEnergyAtInfinity,
  photonAngularMomentumZ,
  observedEnergy = 1,
  mass = SCHWARZSCHILD.mass,
}: {
  radius: number;
  photonEnergyAtInfinity: number;
  photonAngularMomentumZ: number;
  observedEnergy?: number;
  mass?: number;
}) {
  if (radius <= 3 * mass || photonEnergyAtInfinity <= 0) return 0;
  const uT = 1 / Math.sqrt(1 - (3 * mass) / radius);
  const omega = Math.sqrt(mass / (radius * radius * radius));
  const emittedEnergy =
    uT * (photonEnergyAtInfinity - omega * photonAngularMomentumZ);
  return emittedEnergy > 0 ? observedEnergy / emittedEnergy : 0;
}

const CIE_X = (wavelengthNm: number) => {
  const t1 = (wavelengthNm - 442) * (wavelengthNm < 442 ? 0.0624 : 0.0374);
  const t2 = (wavelengthNm - 599.8) * (wavelengthNm < 599.8 ? 0.0264 : 0.0323);
  const t3 = (wavelengthNm - 501.1) * (wavelengthNm < 501.1 ? 0.049 : 0.0382);
  return (
    0.362 * Math.exp(-0.5 * t1 * t1) +
    1.056 * Math.exp(-0.5 * t2 * t2) -
    0.065 * Math.exp(-0.5 * t3 * t3)
  );
};

const CIE_Y = (wavelengthNm: number) => {
  const t1 = (wavelengthNm - 568.8) * (wavelengthNm < 568.8 ? 0.0213 : 0.0247);
  const t2 = (wavelengthNm - 530.9) * (wavelengthNm < 530.9 ? 0.0613 : 0.0322);
  return 0.821 * Math.exp(-0.5 * t1 * t1) + 0.286 * Math.exp(-0.5 * t2 * t2);
};

const CIE_Z = (wavelengthNm: number) => {
  const t1 = (wavelengthNm - 437) * (wavelengthNm < 437 ? 0.0845 : 0.0278);
  const t2 = (wavelengthNm - 459) * (wavelengthNm < 459 ? 0.0385 : 0.0725);
  return 1.217 * Math.exp(-0.5 * t1 * t1) + 0.681 * Math.exp(-0.5 * t2 * t2);
};

function planckRadiance(wavelengthMeters: number, temperatureKelvin: number) {
  const h = 6.62607015e-34;
  const c = 299_792_458;
  const k = 1.380649e-23;
  const exponent = (h * c) / (wavelengthMeters * k * temperatureKelvin);
  return (
    (2 * h * c * c) / (Math.pow(wavelengthMeters, 5) * Math.expm1(exponent))
  );
}

export function blackbodyLinearRgb(
  temperatureKelvin: number,
): [number, number, number] {
  const temperature = Math.max(
    BLACKBODY_TEMPERATURE_MIN,
    Math.min(BLACKBODY_TEMPERATURE_MAX, temperatureKelvin),
  );
  let x = 0;
  let y = 0;
  let z = 0;

  for (let wavelength = 380; wavelength <= 780; wavelength += 5) {
    const power = planckRadiance(wavelength * 1e-9, temperature);
    x += power * CIE_X(wavelength);
    y += power * CIE_Y(wavelength);
    z += power * CIE_Z(wavelength);
  }

  const normalization = Math.max(y, 1e-12);
  x /= normalization;
  y = 1;
  z /= normalization;

  const red = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const green = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const blue = 0.0557 * x - 0.204 * y + 1.057 * z;
  const peak = Math.max(red, green, blue, 1e-9);
  return [
    Math.max(0, red / peak),
    Math.max(0, green / peak),
    Math.max(0, blue / peak),
  ];
}

export function createBlackbodyLut(size = 256) {
  const data = new Uint8Array(size * 4);
  for (let index = 0; index < size; index += 1) {
    const temperature =
      BLACKBODY_TEMPERATURE_MIN +
      ((BLACKBODY_TEMPERATURE_MAX - BLACKBODY_TEMPERATURE_MIN) * index) /
        Math.max(size - 1, 1);
    const [red, green, blue] = blackbodyLinearRgb(temperature);
    data[index * 4] = Math.round(Math.min(red, 1) * 255);
    data[index * 4 + 1] = Math.round(Math.min(green, 1) * 255);
    data[index * 4 + 2] = Math.round(Math.min(blue, 1) * 255);
    data[index * 4 + 3] = 255;
  }
  return data;
}

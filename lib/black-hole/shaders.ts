export const fullscreenVertexShader = /* glsl */ `
  precision highp float;
  in vec3 position;
  in vec2 uv;
  out vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const schwarzschildFragmentShader = /* glsl */ `
  precision highp float;

  in vec2 vUv;
  out vec4 outColor;

  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uPrincipalOffset;
  uniform float uFluxPeak;
  uniform float uDiskPeakTemperature;
  uniform float uObserverRadius;
  uniform float uOrbitTilt;
  uniform float uViewAzimuth;
  uniform float uZoom;
  uniform float uDiskOuterRadius;
  uniform float uObserverMotion;
  uniform float uCameraMode;
  uniform float uStarsEnabled;
  uniform sampler2D uBlackbodyLut;

  const float PI = 3.141592653589793;
  const float MASS = 1.0;
  const float HORIZON = 2.0;
  const float PHOTON_SPHERE = 3.0;
  const float DISK_INNER = 6.0;
  const float ORBIT_SECONDS = 72.0;
  const int MAX_STEPS = 224;

  struct OrbitState {
    float u;
    float du;
  };

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float geodesicAcceleration(float u) {
    return -u + 3.0 * MASS * u * u;
  }

  OrbitState rk4Step(OrbitState state, float h) {
    float k1u = state.du;
    float k1v = geodesicAcceleration(state.u);
    float k2u = state.du + 0.5 * h * k1v;
    float k2v = geodesicAcceleration(state.u + 0.5 * h * k1u);
    float k3u = state.du + 0.5 * h * k2v;
    float k3v = geodesicAcceleration(state.u + 0.5 * h * k2u);
    float k4u = state.du + h * k3v;
    float k4v = geodesicAcceleration(state.u + h * k3u);

    OrbitState nextState;
    nextState.u = state.u + (h / 6.0) * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
    nextState.du = state.du + (h / 6.0) * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
    return nextState;
  }

  vec3 orbitPosition(float radius, float phi, vec3 radialBasis, vec3 tangentBasis) {
    return radius * (cos(phi) * radialBasis + sin(phi) * tangentBasis);
  }

  vec3 orbitDirection(float u, float du, float phi, vec3 radialBasis, vec3 tangentBasis) {
    float radius = 1.0 / max(u, 1e-6);
    float drDphi = -du / max(u * u, 1e-8);
    vec3 er = cos(phi) * radialBasis + sin(phi) * tangentBasis;
    vec3 ephi = -sin(phi) * radialBasis + cos(phi) * tangentBasis;
    return normalize(drDphi * er + radius * ephi);
  }

  float thinDiskFlux(float radius) {
    if (radius <= DISK_INNER || radius >= uDiskOuterRadius) return 0.0;
    float x = sqrt(radius);
    float x0 = sqrt(DISK_INNER);
    float root3 = sqrt(3.0);
    float ratio = ((x - root3) * (x0 + root3)) / max((x + root3) * (x0 - root3), 1e-6);
    float integral = x - x0 - 0.5 * root3 * log(max(ratio, 1e-6));
    return max(0.0, pow(radius, -2.5) * integral / (radius - 3.0));
  }

  vec3 diskRadiance(vec3 hitPosition, float energyInfinity, float angularMomentumZ) {
    float radius = length(hitPosition.xy);
    float flux = thinDiskFlux(radius);
    if (flux <= 0.0) return vec3(0.0);

    float uTimeComponent = inversesqrt(max(1.0 - 3.0 / radius, 1e-5));
    float omega = pow(radius, -1.5);
    float emittedEnergy = uTimeComponent * (energyInfinity - omega * angularMomentumZ);
    float g = clamp(1.0 / max(emittedEnergy, 0.04), 0.18, 3.5);
    float normalizedFlux = clamp(flux / max(uFluxPeak, 1e-8), 0.0, 1.0);
    float emittedTemperature = uDiskPeakTemperature * pow(normalizedFlux, 0.25);
    float observedTemperature = clamp(emittedTemperature * g, 1000.0, 160000.0);
    vec3 spectrum = texture(uBlackbodyLut, vec2((observedTemperature - 1000.0) / 159000.0, 0.5)).rgb;
    float bolometricIntensity = normalizedFlux * pow(g, 4.0);
    return spectrum * bolometricIntensity * 1.15;
  }

  vec3 skyRadiance(vec3 direction) {
    if (uStarsEnabled < 0.5) return vec3(0.0005, 0.0007, 0.0011);
    direction = normalize(direction);
    vec2 skyUv = vec2(
      atan(direction.z, direction.x) / (2.0 * PI) + 0.5,
      asin(clamp(direction.y, -1.0, 1.0)) / PI + 0.5
    );

    vec3 galacticNormal = normalize(vec3(0.17, 0.82, -0.55));
    float latitude = abs(dot(direction, galacticNormal));
    float milkyWay = exp(-latitude * latitude * 42.0);
    float cloud = 0.45 + 0.55 * hash21(floor(skyUv * vec2(220.0, 110.0)));
    vec3 color = vec3(0.0015, 0.0021, 0.0034);
    color += vec3(0.012, 0.018, 0.032) * milkyWay * cloud;

    vec2 cellCountA = vec2(260.0, 130.0);
    vec2 cellA = fract(skyUv * cellCountA) - 0.5;
    vec2 idA = floor(skyUv * cellCountA);
    float randomA = hash21(idA);
    float starA = (1.0 - smoothstep(0.018, 0.085, length(cellA))) * smoothstep(0.992, 1.0, randomA);

    vec2 cellCountB = vec2(520.0, 260.0);
    vec2 cellB = fract(skyUv * cellCountB) - 0.5;
    vec2 idB = floor(skyUv * cellCountB);
    float randomB = hash21(idB + 19.7);
    float starB = (1.0 - smoothstep(0.012, 0.06, length(cellB))) * smoothstep(0.997, 1.0, randomB);

    vec3 warmStar = mix(vec3(0.42, 0.62, 1.0), vec3(1.0, 0.68, 0.34), randomA);
    color += warmStar * starA * (2.0 + 9.0 * randomA);
    color += vec3(0.64, 0.78, 1.0) * starB * (1.0 + 5.0 * randomB);
    return color;
  }

  void main() {
    vec2 sensor = vUv * 2.0 - 1.0;
    sensor.x *= uResolution.x / max(uResolution.y, 1.0);
    sensor.x -= uPrincipalOffset;

    float orbitProgress = step(0.5, uCameraMode) * (1.0 - step(1.5, uCameraMode));
    float phase = radians(uViewAzimuth) + orbitProgress * mod(uTime / ORBIT_SECONDS, 1.0) * 2.0 * PI;
    vec3 orbitA = vec3(1.0, 0.0, 0.0);
    vec3 orbitB = vec3(0.0, cos(uOrbitTilt), sin(uOrbitTilt));
    vec3 cameraPosition = uObserverRadius * (cos(phase) * orbitA + sin(phase) * orbitB);
    vec3 velocityDirection = normalize(-sin(phase) * orbitA + cos(phase) * orbitB);
    vec3 radialBasis = normalize(cameraPosition);
    vec3 forward = -radialBasis;
    vec3 right = normalize(cross(forward, vec3(0.0, 0.0, 1.0)));
    vec3 up = normalize(cross(right, forward));

    float tanHalfFov = 0.7812856265 / max(uZoom, 0.05);
    vec3 cameraFrameDirection = normalize(forward + tanHalfFov * (sensor.x * right + sensor.y * up));

    // Transform the camera-frame photon into the local static Schwarzschild tetrad.
    float beta = sqrt(MASS / (uObserverRadius - 2.0 * MASS)) * uObserverMotion;
    vec3 betaVector = beta * velocityDirection;
    float gamma = inversesqrt(1.0 - beta * beta);
    float betaDotDirection = dot(betaVector, cameraFrameDirection);
    float photonLocalEnergy = gamma * (1.0 + betaDotDirection);
    vec3 photonLocalMomentum = cameraFrameDirection +
      (((gamma - 1.0) * betaDotDirection / max(beta * beta, 1e-8)) + gamma) * betaVector;
    vec3 rayDirection = normalize(photonLocalMomentum / photonLocalEnergy);

    float lapse = sqrt(1.0 - 2.0 * MASS / uObserverRadius);
    float energyInfinity = lapse * photonLocalEnergy;
    float angularMomentumZ = cross(cameraPosition, photonLocalMomentum).z;
    float radialDirection = dot(rayDirection, radialBasis);
    vec3 tangent = rayDirection - radialDirection * radialBasis;
    float tangentLength = length(tangent);

    if (tangentLength < 1e-5) {
      outColor = radialDirection < 0.0 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(skyRadiance(rayDirection), 1.0);
      return;
    }

    vec3 tangentBasis = tangent / tangentLength;
    OrbitState state;
    state.u = 1.0 / uObserverRadius;
    state.du = -state.u * lapse * radialDirection / tangentLength;

    float phi = 0.0;
    vec3 previousPosition = cameraPosition;
    bool resolved = false;
    vec3 radiance = vec3(0.0);

    for (int stepIndex = 0; stepIndex < MAX_STEPS; stepIndex += 1) {
      float photonSphereProximity = 1.0 - smoothstep(0.02, 0.16, abs(state.u - 1.0 / PHOTON_SPHERE));
      float deltaPhi = mix(0.052, 0.022, photonSphereProximity);
      state = rk4Step(state, deltaPhi);
      phi += deltaPhi;

      if (state.u <= 0.0) {
        radiance = skyRadiance(orbitDirection(max(abs(state.u), 1e-6), state.du, phi, radialBasis, tangentBasis));
        resolved = true;
        break;
      }

      float radius = 1.0 / state.u;
      if (radius <= HORIZON * 1.0005) {
        radiance = vec3(0.0);
        resolved = true;
        break;
      }

      vec3 currentPosition = orbitPosition(radius, phi, radialBasis, tangentBasis);
      float denominator = previousPosition.z - currentPosition.z;
      bool crossesMidplane = abs(denominator) > 1e-6 && previousPosition.z * currentPosition.z <= 0.0;
      bool liesInMidplane = abs(previousPosition.z) <= 1e-6 && abs(currentPosition.z) <= 1e-6;
      vec3 diskPosition = currentPosition;

      if (crossesMidplane) {
        float segmentPosition = clamp(previousPosition.z / denominator, 0.0, 1.0);
        diskPosition = mix(previousPosition, currentPosition, segmentPosition);
      }

      float diskRadius = length(diskPosition.xy);
      if ((crossesMidplane || liesInMidplane) && diskRadius >= DISK_INNER && diskRadius <= uDiskOuterRadius) {
        radiance = diskRadiance(diskPosition, energyInfinity, angularMomentumZ);
        resolved = true;
        break;
      }

      if (radius >= uObserverRadius * 1.08 && state.du < 0.0 && phi > 0.35) {
        radiance = skyRadiance(orbitDirection(state.u, state.du, phi, radialBasis, tangentBasis));
        resolved = true;
        break;
      }

      previousPosition = currentPosition;
    }

    if (!resolved) {
      // Near-critical rays can remain close to the photon sphere beyond the step budget.
      radiance = vec3(0.0);
    }

    outColor = vec4(radiance, 1.0);
  }
`;

export const bloomFragmentShader = /* glsl */ `
  precision highp float;

  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uInput;
  uniform vec2 uDirection;
  uniform float uExtract;

  vec3 sampleBloom(vec2 uv) {
    vec3 color = texture(uInput, uv).rgb;
    if (uExtract > 0.5) {
      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color *= smoothstep(0.62, 1.45, luminance);
    }
    return color;
  }

  void main() {
    vec3 color = sampleBloom(vUv) * 0.227027;
    color += sampleBloom(vUv + uDirection * 1.384615) * 0.316216;
    color += sampleBloom(vUv - uDirection * 1.384615) * 0.316216;
    color += sampleBloom(vUv + uDirection * 3.230769) * 0.070270;
    color += sampleBloom(vUv - uDirection * 3.230769) * 0.070270;
    outColor = vec4(color, 1.0);
  }
`;

export const compositeFragmentShader = /* glsl */ `
  precision highp float;

  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uScene;
  uniform sampler2D uBloom;
  uniform float uBloomStrength;
  uniform float uExposure;

  vec3 acesFilm(vec3 color) {
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
  }

  void main() {
    vec3 hdr = texture(uScene, vUv).rgb + texture(uBloom, vUv).rgb * uBloomStrength;
    vec3 mapped = acesFilm(hdr * uExposure);
    mapped = pow(mapped, vec3(1.0 / 2.2));
    outColor = vec4(mapped, 1.0);
  }
`;

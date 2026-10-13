import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BALL_COLOR = 0xf1f5ff;
const TRAIL_COUNT = 32;
const TRAIL_LENGTH = 64;
const TRAIL_INTERVAL = 75;

/**
 * Owns its animation loop. Snapshots contain physical world-space positions;
 * camera movement and optional history lines never alter the simulation.
 */
export function createRenderer(host, {
  onError = () => {}, onFps = () => {}, onContextState = () => {},
} = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch (error) {
    onError(`无法启动三维画面：${error.message}`);
    throw error;
  }

  renderer.setClearColor(0x050610, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', '自由空间中的三维引力小球，可拖动旋转、滚动缩放');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.screenSpacePanning = true;

  // Camera-facing luminous points: no scene lighting or sphere shading.
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uRadius: { value: 0.15 },
      uViewportHeight: { value: 1 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `
      uniform float uRadius;
      uniform float uViewportHeight;
      uniform float uPixelRatio;
      varying float vBrightness;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float diameter = uRadius * uViewportHeight * projectionMatrix[1][1]
          / max(-viewPosition.z, 0.0001) * 0.55;
        vBrightness = clamp(diameter / uPixelRatio * 0.18, 0.4, 1.0);
        gl_PointSize = clamp(diameter, 1.2 * uPixelRatio, 24.0 * uPixelRatio) * 3.5;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying float vBrightness;
      void main() {
        float distanceFromCenter = length(gl_PointCoord * 2.0 - 1.0);
        float core = 1.0 - smoothstep(0.22, 0.30, distanceFromCenter);
        float halo = exp(-distanceFromCenter * distanceFromCenter * 10.0) * 0.18
          * (1.0 - smoothstep(0.65, 1.0, distanceFromCenter));
        float opacity = min(core + halo, 1.0) * vBrightness;
        if (opacity < 0.004) discard;
        gl_FragColor = vec4(0.93, 0.96, 1.0, opacity);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  let quality = 'auto';
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  let geometry = new THREE.BufferGeometry();
  let mesh = null;
  let capacity = 0;
  let count = 0;
  let radius = 0.15;
  let positions = new Float32Array(0);
  let hasSnapshot = false;
  let disposed = false;
  let contextLost = false;
  let followCenter = false;
  const cloudCenter = new THREE.Vector3();
  const previousCenter = new THREE.Vector3();
  let cloudRadius = 1;
  let frameId = 0;
  let lastFrame = 0;
  let fpsStart = 0;
  let fpsFrames = 0;
  let lastQualityCheck = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  const viewDirection = new THREE.Vector3(1, 0.68, 1).normalize();
  const offset = new THREE.Vector3();

  let trailsEnabled = false;
  let trailSamples = 0;
  let trailWrite = 0;
  let lastTrailAt = 0;
  let trailHistory = new Float32Array(0);
  let trailPositions = new Float32Array(0);
  let trailGeometry = null;
  let trailLines = null;
  const trailMaterial = new THREE.LineBasicMaterial({
    color: BALL_COLOR,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });

  function resize() {
    if (disposed) return;
    const { width, height } = host.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    const nextWidth = Math.round(width);
    const nextHeight = Math.round(height);
    if (nextWidth === lastWidth && nextHeight === lastHeight) return;
    lastWidth = nextWidth;
    lastHeight = nextHeight;
    renderer.setSize(nextWidth, nextHeight, false);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
  }

  function fit(resetDirection = false) {
    if (disposed || !hasSnapshot) return;
    resize();
    const direction = resetDirection
      ? viewDirection
      : offset.copy(camera.position).sub(controls.target).normalize();
    if (direction.lengthSq() < 0.5) direction.copy(viewDirection);
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const distance = (cloudRadius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.17;
    controls.target.copy(cloudCenter);
    camera.position.copy(cloudCenter).addScaledVector(direction, distance);
    camera.near = Math.max(radius * 0.025, distance * 0.0001, 0.0001);
    camera.far = Math.max(distance * 10, cloudRadius * 20, 100);
    controls.minDistance = radius * 1.5;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function resetTrails() {
    trailSamples = 0;
    trailWrite = 0;
    lastTrailAt = 0;
    if (trailGeometry) trailGeometry.setDrawRange(0, 0);
  }

  function rebuildTrails() {
    if (trailLines) scene.remove(trailLines);
    if (trailGeometry) trailGeometry.dispose();
    trailLines = null;
    trailGeometry = null;
    resetTrails();
    if (!trailsEnabled || !count) return;
    const tracked = Math.min(count, TRAIL_COUNT);
    trailHistory = new Float32Array(tracked * TRAIL_LENGTH * 3);
    trailPositions = new Float32Array(tracked * (TRAIL_LENGTH - 1) * 2 * 3);
    trailGeometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(trailPositions, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    trailGeometry.setAttribute('position', attribute);
    trailGeometry.setDrawRange(0, 0);
    trailLines = new THREE.LineSegments(trailGeometry, trailMaterial);
    trailLines.frustumCulled = false;
    scene.add(trailLines);
  }

  function sampleTrails(now) {
    if (!trailsEnabled || !trailGeometry || now - lastTrailAt < TRAIL_INTERVAL) return;
    lastTrailAt = now;
    const tracked = Math.min(count, TRAIL_COUNT);
    for (let t = 0; t < tracked; t++) {
      const particle = Math.floor((t * count) / tracked);
      const src = particle * 3;
      const dest = (t * TRAIL_LENGTH + trailWrite) * 3;
      trailHistory[dest] = positions[src];
      trailHistory[dest + 1] = positions[src + 1];
      trailHistory[dest + 2] = positions[src + 2];
    }
    trailWrite = (trailWrite + 1) % TRAIL_LENGTH;
    trailSamples = Math.min(trailSamples + 1, TRAIL_LENGTH);
    let vertex = 0;
    for (let t = 0; t < tracked; t++) {
      for (let j = 1; j < trailSamples; j++) {
        const a = (trailWrite - trailSamples + j - 1 + TRAIL_LENGTH) % TRAIL_LENGTH;
        const b = (a + 1) % TRAIL_LENGTH;
        for (const sample of [a, b]) {
          const src = (t * TRAIL_LENGTH + sample) * 3;
          trailPositions[vertex++] = trailHistory[src];
          trailPositions[vertex++] = trailHistory[src + 1];
          trailPositions[vertex++] = trailHistory[src + 2];
        }
      }
    }
    trailGeometry.setDrawRange(0, vertex / 3);
    trailGeometry.attributes.position.needsUpdate = true;
  }

  function setSnapshot(nextPositions, { count: nextCount = nextPositions.length / 3, radius: nextRadius = radius } = {}) {
    if (disposed) return;
    if (!ArrayBuffer.isView(nextPositions) || nextCount < 0 || !Number.isInteger(nextCount)
      || nextPositions.length < nextCount * 3 || !(nextRadius > 0) || !Number.isFinite(nextRadius)) {
      onError('收到无效的小球位置数据。');
      return;
    }
    const changedCount = count !== nextCount;
    if (nextCount > capacity) {
      capacity = Math.max(64, 2 ** Math.ceil(Math.log2(nextCount)));
      positions = new Float32Array(capacity * 3);
      if (mesh) {
        scene.remove(mesh);
      }
      geometry.dispose();
      geometry = new THREE.BufferGeometry();
      const attribute = new THREE.BufferAttribute(positions, 3);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', attribute);
      mesh = new THREE.Points(geometry, material);
      // Escaping particles can make a cached point bound obsolete.
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    count = nextCount;
    radius = nextRadius;
    geometry.setDrawRange(0, count);
    material.uniforms.uRadius.value = radius;
    if (!count) {
      if (changedCount) rebuildTrails();
      return;
    }
    // Copy so the caller can transfer/recycle its snapshot buffer immediately.
    positions.set(nextPositions.subarray(0, count * 3));
    previousCenter.copy(cloudCenter);
    cloudCenter.set(0, 0, 0);
    for (let i = 0; i < count; i++) {
      const base = i * 3;
      const x = positions[base];
      const y = positions[base + 1];
      const z = positions[base + 2];
      cloudCenter.x += x;
      cloudCenter.y += y;
      cloudCenter.z += z;
    }
    cloudCenter.multiplyScalar(1 / count);
    cloudRadius = radius;
    for (let i = 0; i < count; i++) {
      const base = i * 3;
      const dx = positions[base] - cloudCenter.x;
      const dy = positions[base + 1] - cloudCenter.y;
      const dz = positions[base + 2] - cloudCenter.z;
      cloudRadius = Math.max(cloudRadius, Math.sqrt(dx * dx + dy * dy + dz * dz) + radius);
    }
    geometry.attributes.position.needsUpdate = true;
    if (followCenter && hasSnapshot) {
      offset.copy(cloudCenter).sub(previousCenter);
      camera.position.add(offset);
      controls.target.add(offset);
    }
    // Updating the clipping plane does not move, contain, or delete particles.
    const far = Math.max(camera.position.distanceTo(cloudCenter) + cloudRadius * 3, 100);
    if (far > camera.far || far < camera.far * 0.5) {
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    if (changedCount) rebuildTrails();
    sampleTrails(performance.now());
    if (!hasSnapshot) {
      hasSnapshot = true;
      // Fit once on first load; later initial states keep the current camera.
      fit(true);
    }
  }

  function setQuality(value) {
    if (!['auto', 'high', 'low'].includes(value) || disposed) return;
    quality = value;
    pixelRatio = Math.min(window.devicePixelRatio || 1, value === 'high' ? 2 : value === 'low' ? 1 : 1.5);
    renderer.setPixelRatio(pixelRatio);
    // setPixelRatio resizes the backing canvas using its existing logical size.
    resize();
    lastQualityCheck = performance.now();
  }

  function handleContextLost(event) {
    event.preventDefault();
    contextLost = true;
    onContextState(false);
  }

  function handleContextRestored() {
    contextLost = false;
    lastFrame = 0;
    if (mesh) geometry.attributes.position.needsUpdate = true;
    if (trailGeometry) trailGeometry.attributes.position.needsUpdate = true;
    resize();
    onContextState(true);
  }

  function animate(now) {
    if (disposed) return;
    frameId = requestAnimationFrame(animate);
    if (document.hidden || contextLost || !lastWidth || !lastHeight) {
      lastFrame = 0;
      fpsStart = 0;
      fpsFrames = 0;
      return;
    }
    const deltaSeconds = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 1 / 60;
    lastFrame = now;
    controls.update(deltaSeconds);
    material.uniforms.uViewportHeight.value = lastHeight * renderer.getPixelRatio();
    material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    renderer.render(scene, camera);
    if (!fpsStart) fpsStart = now;
    fpsFrames++;
    if (now - fpsStart >= 1000) {
      const fps = (fpsFrames * 1000) / (now - fpsStart);
      onFps(Math.round(fps));
      if (quality === 'auto' && now - lastQualityCheck > 4000) {
        const ceiling = Math.min(window.devicePixelRatio || 1, 1.5);
        const next = fps < 36 ? Math.max(0.8, pixelRatio - 0.2)
          : fps > 55 ? Math.min(ceiling, pixelRatio + 0.1) : pixelRatio;
        if (Math.abs(next - pixelRatio) > 0.01) {
          pixelRatio = next;
          renderer.setPixelRatio(pixelRatio);
        }
        lastQualityCheck = now;
      }
      fpsStart = now;
      fpsFrames = 0;
    }
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  canvas.addEventListener('webglcontextlost', handleContextLost);
  canvas.addEventListener('webglcontextrestored', handleContextRestored);
  renderer.setPixelRatio(pixelRatio);
  camera.position.copy(viewDirection).multiplyScalar(10);
  controls.update();
  resize();
  frameId = requestAnimationFrame(animate);

  return {
    setSnapshot,
    fit: () => fit(false),
    resetView: () => fit(true),
    setFollowCenter: (value) => { followCenter = Boolean(value); },
    setTrails: (value) => {
      const next = Boolean(value);
      if (next !== trailsEnabled) {
        trailsEnabled = next;
        rebuildTrails();
      }
    },
    resetTrails,
    setQuality,
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.dispose();
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      if (trailGeometry) trailGeometry.dispose();
      trailMaterial.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      scene.clear();
      canvas.remove();
      positions = new Float32Array(0);
      trailHistory = new Float32Array(0);
      trailPositions = new Float32Array(0);
    },
  };
}

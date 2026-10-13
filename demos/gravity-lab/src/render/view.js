import { Matrix4, PerspectiveCamera, Vector3, MathUtils } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTICLE_RADIUS } from '../physics/constants.js';

/** Camera/input state shared by both graphics adapters; Runtime owns the clock. */
export function createView(host, canvas, { onFps = () => {} } = {}, saved) {
  const camera = new PerspectiveCamera(43, 1, .01, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = .07;
  controls.screenSpacePanning = true;
  const center = new Vector3(), direction = new Vector3(1, .68, 1).normalize();
  camera.position.copy(direction).multiplyScalar(10);
  let radius = PARTICLE_RADIUS, cloudRadius = 1, hasBounds = false;
  let quality = saved?.quality || 'auto';
  let ratio = Math.min(globalThis.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'low' ? 1 : 1.5);
  let width = 1, height = 1, last = 0, fpsAt = 0, frames = 0, qualityAt = 0;
  let boundsAt = 0, maxSpeed = 0;
  const matrix = new Matrix4(), originTransform = new Matrix4();
  if (saved) {
    camera.position.fromArray(saved.position);
    controls.target.fromArray(saved.target);
    camera.near = saved.near;
    camera.far = saved.far;
    hasBounds = saved.hasBounds;
    controls.minDistance = saved.minDistance ?? PARTICLE_RADIUS * 1.5;
  }
  function resize() {
    const box = host.getBoundingClientRect();
    width = Math.max(1, Math.round(box.width));
    height = Math.max(1, Math.round(box.height));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  controls.update();
  function fit(initial = false) {
    if (!hasBounds) return;
    const heading = initial ? direction.clone() : camera.position.clone().sub(controls.target).normalize();
    if (heading.lengthSq() < .5) heading.copy(direction);
    const vfov = MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const distance = cloudRadius / Math.sin(Math.min(vfov, hfov) / 2) * 1.17;
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(heading, distance);
    camera.near = Math.max(radius * .025, distance * .0001, .0001);
    camera.far = Math.max(distance * 10, cloudRadius * 20, 100);
    controls.minDistance = radius * 1.5;
    camera.updateProjectionMatrix();
    controls.update();
  }
  function setBounds(bounds, nextRadius = radius) {
    if (!bounds?.center || !Number.isFinite(bounds.radius)) return;
    const first = !hasBounds;
    radius = nextRadius;
    center.fromArray(bounds.center);
    cloudRadius = Math.max(radius, bounds.radius);
    maxSpeed = bounds.maxSpeed || 0;
    boundsAt = performance.now();
    hasBounds = true;
    if (first) fit(true);
  }
  return {
    camera, controls,
    get width() { return Math.max(1, Math.round(width * ratio)); },
    get height() { return Math.max(1, Math.round(height * ratio)); },
    get pixelRatio() { return ratio; },
    setBounds, fit,
    setQuality(value) {
      quality = value;
      ratio = Math.min(globalThis.devicePixelRatio || 1, value === 'high' ? 2 : value === 'low' ? 1 : 1.5);
      qualityAt = performance.now();
    },
    update(now) {
      controls.update(last ? Math.min((now - last) / 1000, .1) : 1 / 60);
      last = now;
      // Bounds may arrive later than the active GPU state. Give fast escapers
      // a generous envelope (20x maximum playback), without moving the camera.
      const margin = maxSpeed * Math.max(0, now - boundsAt) / 1000 * 40;
      const far = Math.max(camera.position.distanceTo(center) + (cloudRadius + margin) * 4, 100);
      if (far > camera.far || far < camera.far * .5) {
        camera.far = far;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
    },
    rendered(now) {
      if (!fpsAt) fpsAt = now;
      frames++;
      if (now - fpsAt < 1000) return;
      const fps = frames * 1000 / (now - fpsAt);
      onFps(Math.round(fps));
      if (quality === 'auto' && now - qualityAt > 4000) {
        ratio = fps < 36 ? Math.max(.8, ratio - .2)
          : fps > 55 ? Math.min(globalThis.devicePixelRatio || 1, 1.5, ratio + .1) : ratio;
        qualityAt = now;
      }
      fpsAt = now; frames = 0;
    },
    projection(origin = [0, 0, 0]) {
      originTransform.makeTranslation(...origin);
      return matrix.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(originTransform).elements;
    },
    save() {
      return { position: camera.position.toArray(), target: controls.target.toArray(),
        near: camera.near, far: camera.far, minDistance: controls.minDistance, hasBounds, quality };
    },
    dispose() { observer.disconnect(); controls.dispose(); },
  };
}

export function createCanvas(host) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', '自由空间中的三维引力粒子，可拖动旋转、滚动缩放');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
  host.appendChild(canvas);
  return canvas;
}

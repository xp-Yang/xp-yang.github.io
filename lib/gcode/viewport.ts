import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { drawRanges } from './geometry';
import { createInstanceMesh } from './instance-mesh';
import { createProgressiveRenderer } from './progressive-renderer';
import { createRefinementLoop, refinementSamples } from './refinement';
import { type GcodeModel, type MeshBatch, type ViewRange } from './types';

type RenderBatch = {
  source: MeshBatch;
  view: ReturnType<typeof createInstanceMesh>;
};

export function createViewport(
  host: HTMLElement,
  onError: (message: string) => void,
  onFps: (fps: number) => void = () => {},
  onRefining: (refining: boolean) => void = () => {},
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x080c12, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute(
    'aria-label',
    '三维 GCode 走线，可拖动旋转、滚轮缩放',
  );
  renderer.domElement.setAttribute('role', 'img');
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 10000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  const ambient = new THREE.HemisphereLight(0xe5efff, 0x363b4a, 2.3);
  ambient.position.set(0, 0, 1);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff2df, 2.3);
  key.position.set(-80, -60, 140);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fc8ff, 1.5);
  fill.position.set(50, 70, 50);
  scene.add(fill);
  let group = new THREE.Group();
  scene.add(group);
  let batches: RenderBatch[] = [];
  let model: GcodeModel | null = null;
  let grid: THREE.GridHelper | null = null;
  let disposed = false,
    contextFailed = false;
  const drawingSize = new THREE.Vector2();
  let renderedFrames = 0;
  let sampleStart = performance.now();
  // Count actual scene renders, not idle requestAnimationFrame callbacks.
  const fpsTimer = window.setInterval(() => {
    const now = performance.now();
    const elapsed = now - sampleStart;
    onFps(
      document.hidden || elapsed <= 0
        ? 0
        : Math.round((renderedFrames * 1000) / elapsed),
    );
    renderedFrames = 0;
    sampleStart = now;
  }, 500);
  const resetFps = () => {
    renderedFrames = 0;
    sampleStart = performance.now();
    onFps(0);
  };
  const samples = refinementSamples(
    window.matchMedia('(pointer: coarse)').matches,
  );
  const progressive = createProgressiveRenderer(
    renderer,
    scene,
    camera,
    samples,
    () => renderedFrames++,
  );
  const loop = createRefinementLoop(
    {
      direct: () => {
        if (disposed || contextFailed) return;
        renderer.render(scene, camera);
        renderedFrames++;
      },
      sample: () => progressive.sample(),
      reset: () => progressive.reset(),
      available: () => !!model && !contextFailed && progressive.available(),
      state: onRefining,
    },
    samples,
  );
  const visibilityChanged = () => {
    resetFps();
    if (document.hidden) loop.suspend();
    else if (!contextFailed) loop.resume();
  };
  document.addEventListener('visibilitychange', visibilityChanged);
  const invalidate = () => loop.invalidate();
  controls.addEventListener('change', invalidate);
  controls.addEventListener('start', loop.startInteraction);
  controls.addEventListener('end', loop.endInteraction);
  const resize = () => {
    const width = host.clientWidth,
      height = host.clientHeight;
    if (width < 1 || height < 1) return;
    renderer.setSize(width, height);
    renderer.getDrawingBufferSize(drawingSize);
    progressive.resize(drawingSize.x, drawingSize.y);
    batches.forEach((batch) => batch.view.setPixelHeight(drawingSize.y));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    invalidate();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const contextLost = (event: Event) => {
    event.preventDefault();
    contextFailed = true;
    loop.suspend();
    progressive.dispose();
    resetFps();
    onError('图形上下文已丢失，请刷新页面重新加载。');
  };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  const disposeGroup = (target: THREE.Group) => {
    target.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    target.clear();
  };
  const reset = () => {
    if (!model) return;
    const min = new THREE.Vector3(
      ...(model.bounds.min as [number, number, number]),
    );
    const max = new THREE.Vector3(
      ...(model.bounds.max as [number, number, number]),
    );
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = min.distanceTo(max) / 2;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.13;
    controls.target.copy(center);
    camera.position
      .copy(center)
      .add(
        new THREE.Vector3(1.05, -1.4, 1.1).normalize().multiplyScalar(distance),
      );
    camera.near = Math.max(0.01, radius / 1000);
    camera.far = Math.max(1000, distance * 20);
    controls.minDistance = Math.max(0.1, radius * 0.08);
    controls.maxDistance = distance * 6;
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  };
  const setRange = (range: ViewRange) => {
    if (!model) return;
    for (const batch of batches) {
      const intervals = drawRanges(batch.source, model.layers, range);
      batch.view.setIntervals(intervals);
    }
    invalidate();
  };
  resize();
  if (document.hidden) loop.suspend();
  return {
    reset,
    setRange,
    setModel(next: GcodeModel) {
      const nextGroup = new THREE.Group();
      const nextBatches: RenderBatch[] = [];
      try {
        for (const source of next.batches) {
          const view = createInstanceMesh(source, drawingSize.y);
          nextGroup.add(view.mesh);
          nextBatches.push({ source, view });
        }
      } catch (error) {
        disposeGroup(nextGroup);
        throw error;
      }
      scene.remove(group);
      disposeGroup(group);
      group = nextGroup;
      batches = nextBatches;
      model = next;
      scene.add(group);
      if (grid) {
        scene.remove(grid);
        grid.geometry.dispose();
        (grid.material as THREE.Material).dispose();
      }
      const span = Math.max(
        next.bounds.max[0] - next.bounds.min[0],
        next.bounds.max[1] - next.bounds.min[1],
        20,
      );
      const gridSize = Math.ceil((span * 1.7) / 10) * 10;
      grid = new THREE.GridHelper(gridSize, 20, '#3a444f', '#222c38');
      grid.rotation.x = Math.PI / 2;
      grid.position.set(
        (next.bounds.min[0] + next.bounds.max[0]) / 2,
        (next.bounds.min[1] + next.bounds.max[1]) / 2,
        next.bounds.min[2] - 0.1,
      );
      scene.add(grid);
      reset();
    },
    dispose() {
      disposed = true;
      loop.dispose();
      progressive.dispose();
      window.clearInterval(fpsTimer);
      document.removeEventListener('visibilitychange', visibilityChanged);
      controls.removeEventListener('change', invalidate);
      controls.removeEventListener('start', loop.startInteraction);
      controls.removeEventListener('end', loop.endInteraction);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      disposeGroup(group);
      if (grid) {
        grid.geometry.dispose();
        (grid.material as THREE.Material).dispose();
      }
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

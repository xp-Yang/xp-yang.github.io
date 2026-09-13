import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createProgressiveRenderer } from '../lib/gcode/progressive-renderer';

function setup(supported = true) {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  camera.setViewOffset(640, 480, 10, 20, 320, 240);
  let target: THREE.WebGLRenderTarget | null = null,
    alpha = 0.25;
  const clear = new THREE.Color('#123456');
  const targets = new Set<THREE.WebGLRenderTarget>();
  let released = 0,
    completedDraws = 0,
    failAllocation = false,
    failDraw = false;
  const renderer = {
    autoClear: false,
    extensions: { has: () => supported },
    getRenderTarget: () => target,
    setRenderTarget(value: THREE.WebGLRenderTarget | null) {
      target = value;
      if (value && !targets.has(value)) {
        targets.add(value);
        value.addEventListener('dispose', () => released++);
      }
    },
    getClearColor: (color: THREE.Color) => color.copy(clear),
    getClearAlpha: () => alpha,
    setClearColor(value: THREE.ColorRepresentation, a: number) {
      clear.set(value);
      alpha = a;
    },
    getContext: () => ({
      FRAMEBUFFER: 1,
      FRAMEBUFFER_COMPLETE: 2,
      NO_ERROR: 0,
      checkFramebufferStatus: () => (failAllocation ? 3 : 2),
      getError: () => 0,
    }),
    render(object: THREE.Object3D) {
      if (object === scene && failDraw) throw new Error('render failed');
    },
  };
  const pass = createProgressiveRenderer(
    renderer as unknown as THREE.WebGLRenderer,
    scene,
    camera,
    16,
    () => completedDraws++,
  );
  return {
    renderer,
    pass,
    camera,
    clear,
    targets,
    draws: () => completedDraws,
    released: () => released,
    failAllocation(value: boolean) {
      failAllocation = value;
    },
    failDraw() {
      failDraw = true;
    },
  };
}

void test('sampling restores camera, clear color and target, and releases buffers on resize/disposal', () => {
  const s = setup();
  const projection = s.camera.projectionMatrix.toArray();
  const inverse = s.camera.projectionMatrixInverse.toArray();
  const view = { ...s.camera.view };
  const color = s.clear.clone();
  s.pass.resize(320, 240);
  for (let i = 0; i < 16; i++) assert.equal(s.pass.sample(), true);
  assert.equal(s.pass.sample(), false);
  assert.equal(s.draws(), 16);
  assert.deepEqual(s.camera.view, view);
  assert.deepEqual(s.camera.projectionMatrix.toArray(), projection);
  assert.deepEqual(s.camera.projectionMatrixInverse.toArray(), inverse);
  assert.equal(s.renderer.getRenderTarget(), null);
  assert.equal(s.renderer.getClearAlpha(), 0.25);
  assert.equal(s.renderer.autoClear, false);
  assert.ok(s.clear.equals(color));
  assert.equal(s.targets.size, 3);
  s.pass.reset();
  assert.equal(s.pass.sample(), true);
  assert.equal(s.targets.size, 3);
  s.pass.resize(400, 300);
  assert.equal(s.released(), 3);
  assert.equal(s.pass.sample(), true);
  assert.equal(s.targets.size, 6);
  s.pass.dispose();
  assert.equal(s.released(), 6);
  assert.equal(s.pass.available(), false);
  s.pass.dispose();
  assert.equal(s.released(), 6);
});

void test('unsupported floats and oversized buffers never allocate GPU targets', () => {
  for (const supported of [true, false]) {
    const s = setup(supported);
    s.pass.resize(supported ? 3840 : 640, supported ? 2160 : 480);
    assert.equal(s.pass.available(), false);
    assert.equal(s.pass.sample(), false);
    assert.equal(s.targets.size, 0);
    s.pass.dispose();
  }
});

void test('allocation failure cleans partial targets and retries only after size changes', () => {
  const s = setup();
  s.pass.resize(320, 240);
  s.failAllocation(true);
  assert.equal(s.pass.sample(), false);
  assert.equal(s.released(), 1);
  assert.equal(s.pass.available(), false);
  s.failAllocation(false);
  s.pass.reset();
  assert.equal(s.pass.sample(), false);
  s.pass.resize(400, 300);
  assert.equal(s.pass.sample(), true);
  s.pass.dispose();
  assert.equal(s.released(), 4);
});

void test('failed scene draws still restore the original camera projection and free buffers', () => {
  const s = setup();
  const projection = s.camera.projectionMatrix.toArray(),
    view = { ...s.camera.view };
  s.pass.resize(320, 240);
  s.failDraw();
  assert.equal(s.pass.sample(), false);
  assert.deepEqual(s.camera.projectionMatrix.toArray(), projection);
  assert.deepEqual(s.camera.view, view);
  assert.equal(s.renderer.getRenderTarget(), null);
  assert.equal(s.released(), 3);
  s.pass.dispose();
});

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import {
  jitterOffset,
  refinementBytes,
  REFINEMENT_BUDGET_BYTES,
} from './refinement';

const vertexShader = `varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Accumulates linear, premultiplied samples, then encodes the final canvas once. */
export function createProgressiveRenderer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sampleCount: number,
  onSceneDraw: () => void,
) {
  let targets: THREE.WebGLRenderTarget[] = [];
  let width = 0,
    height = 0,
    index = 0,
    failed = false;
  const supported = renderer.extensions.has('EXT_color_buffer_float');
  const average = new THREE.ShaderMaterial({
    uniforms: {
      current: { value: null },
      history: { value: null },
      weight: { value: 1 },
    },
    vertexShader,
    fragmentShader: `varying vec2 vUv;
      uniform sampler2D current; uniform sampler2D history; uniform float weight;
      void main() {
        vec4 sampleColor = texture2D(current, vUv);
        sampleColor.rgb *= sampleColor.a;
        if (weight == 1.0) gl_FragColor = sampleColor;
        else gl_FragColor = mix(texture2D(history, vUv), sampleColor, weight);
      }`,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
  const output = new THREE.ShaderMaterial({
    uniforms: { image: { value: null } },
    vertexShader,
    fragmentShader: `varying vec2 vUv; uniform sampler2D image;
      void main() {
        vec4 color = texture2D(image, vUv);
        gl_FragColor = vec4(color.a > 0.0 ? color.rgb / color.a : vec3(0.0), color.a);
        #include <colorspace_fragment>
        gl_FragColor.rgb *= gl_FragColor.a;
      }`,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
  const quad = new FullScreenQuad(average);
  const release = () => {
    targets.forEach((target) => target.dispose());
    targets = [];
    average.uniforms.current.value = average.uniforms.history.value = null;
    output.uniforms.image.value = null;
    index = 0;
  };
  const available = () =>
    supported &&
    !failed &&
    width > 0 &&
    height > 0 &&
    refinementBytes(width, height) <= REFINEMENT_BUDGET_BYTES;
  const allocate = () => {
    if (targets.length) return;
    const previous = renderer.getRenderTarget();
    try {
      for (let i = 0; i < 3; i++) {
        const target = new THREE.WebGLRenderTarget(width, height, {
          type: THREE.HalfFloatType,
          format: THREE.RGBAFormat,
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
          depthBuffer: i === 0,
          stencilBuffer: false,
          generateMipmaps: false,
        });
        target.texture.colorSpace = THREE.LinearSRGBColorSpace;
        targets.push(target);
        renderer.setRenderTarget(target);
        const gl = renderer.getContext();
        if (
          gl.checkFramebufferStatus(gl.FRAMEBUFFER) !==
            gl.FRAMEBUFFER_COMPLETE ||
          gl.getError() !== gl.NO_ERROR
        )
          throw new Error('Cannot allocate refinement buffers');
      }
    } finally {
      renderer.setRenderTarget(previous);
    }
  };
  return {
    available,
    reset() {
      index = 0;
    },
    resize(w: number, h: number) {
      if (w === width && h === height) return;
      release();
      width = w;
      height = h;
      failed = false;
    },
    sample() {
      if (!available() || index >= sampleCount) return false;
      const target = renderer.getRenderTarget();
      const clear = renderer.getClearColor(new THREE.Color());
      const alpha = renderer.getClearAlpha(),
        autoClear = renderer.autoClear;
      const view = camera.view ? { ...camera.view } : null;
      const projection = camera.projectionMatrix.clone();
      const inverse = camera.projectionMatrixInverse.clone();
      try {
        allocate();
        const [x, y] = jitterOffset(index, sampleCount);
        camera.setViewOffset(
          view?.enabled ? view.fullWidth : width,
          view?.enabled ? view.fullHeight : height,
          (view?.enabled ? view.offsetX : 0) + x,
          (view?.enabled ? view.offsetY : 0) + y,
          view?.enabled ? view.width : width,
          view?.enabled ? view.height : height,
        );
        renderer.autoClear = true;
        renderer.setClearColor(0x000000, 0);
        renderer.setRenderTarget(targets[0]);
        renderer.render(scene, camera);
        onSceneDraw();
        const read = targets[1 + (index % 2)],
          write = targets[1 + ((index + 1) % 2)];
        average.uniforms.current.value = targets[0].texture;
        average.uniforms.history.value = read.texture;
        average.uniforms.weight.value = 1 / (index + 1);
        quad.material = average;
        renderer.setRenderTarget(write);
        quad.render(renderer);
        output.uniforms.image.value = write.texture;
        quad.material = output;
        renderer.setRenderTarget(null);
        quad.render(renderer);
        index++;
        return true;
      } catch {
        failed = true;
        release();
        return false;
      } finally {
        camera.view = view;
        camera.projectionMatrix.copy(projection);
        camera.projectionMatrixInverse.copy(inverse);
        renderer.setRenderTarget(target);
        renderer.setClearColor(clear, alpha);
        renderer.autoClear = autoClear;
      }
    },
    dispose() {
      release();
      failed = true;
      quad.dispose();
      average.dispose();
      output.dispose();
    },
  };
}

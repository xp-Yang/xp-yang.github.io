import * as THREE from 'three';
import { ROLES, type MeshBatch } from './types';

// Left/down/right/up at each endpoint: the original XPYEngine cross section.
const VERTICES = [
  1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, -1, -1, 1, 0, 0, 1, 1,
];
const NORMALS = [
  1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0, 1,
];
const FACES = [
  0, 1, 2, 0, 2, 3, 7, 6, 5, 7, 5, 4, 4, 5, 1, 4, 1, 0, 3, 2, 6, 3, 6, 7, 1, 5,
  6, 1, 6, 2, 4, 0, 3, 4, 3, 7,
];

export function createInstanceMesh(source: MeshBatch, pixelHeight = 1) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(VERTICES, 3),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(NORMALS, 3));
  geometry.setIndex(FACES);
  const instances = new THREE.InstancedInterleavedBuffer(source.instances, 8);
  geometry.setAttribute(
    'pathStart',
    new THREE.InterleavedBufferAttribute(instances, 3, 0),
  );
  geometry.setAttribute(
    'pathEnd',
    new THREE.InterleavedBufferAttribute(instances, 3, 3),
  );
  geometry.setAttribute(
    'pathSize',
    new THREE.InterleavedBufferAttribute(instances, 2, 6),
  );
  geometry.instanceCount = source.moveIds.length;
  const range = { value: new THREE.Vector3(0, 0, source.moveIds.length) };
  const resolution = { value: pixelHeight };
  const material = new THREE.MeshStandardMaterial({
    color: ROLES[source.role].color,
    roughness: 0.52,
    metalness: 0.06,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pathRange = range;
    shader.uniforms.pathPixelHeight = resolution;
    shader.uniforms.pathMutedColor = { value: new THREE.Color('#29303b') };
    shader.vertexShader =
      `
      attribute vec3 pathStart;
      attribute vec3 pathEnd;
      attribute vec2 pathSize;
      uniform vec3 pathRange;
      uniform float pathPixelHeight;
      varying float pathMuted;
      varying float pathDetail;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <beginnormal_vertex>',
        `
      vec2 delta = pathEnd.xy - pathStart.xy;
      float xyLength = length(delta);
      vec2 lateral = xyLength > 0.00000001 ? vec2(-delta.y, delta.x) / xyLength : vec2(1.0, 0.0);
      vec3 objectNormal = vec3(lateral * normal.x, normal.z);
    `,
      )
      .replace(
        '#include <begin_vertex>',
        `
      vec3 transformed = mix(pathStart, pathEnd, position.y)
        + vec3(lateral * position.x * pathSize.x * 0.5, position.z * pathSize.y * 0.5);
      pathMuted = float(gl_InstanceID) < pathRange.y ? 1.0 : 0.0;
    `,
      )
      .replace(
        '#include <project_vertex>',
        `
      #include <project_vertex>
      float pixels = min(pathSize.x, pathSize.y) * projectionMatrix[1][1]
        * pathPixelHeight * 0.5 / max(-mvPosition.z, 0.000001);
      pathDetail = smoothstep(0.75, 2.0, pixels);
      if (float(gl_InstanceID) < pathRange.x || float(gl_InstanceID) >= pathRange.z)
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    `,
      );
    shader.fragmentShader =
      `
      uniform vec3 pathMutedColor;
      varying float pathMuted;
      varying float pathDetail;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, pathMutedColor, pathMuted);
    `,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <roughnessmap_fragment>',
        `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(0.95, roughnessFactor, pathDetail);
      `,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `
        #include <metalnessmap_fragment>
        metalnessFactor *= pathDetail;
      `,
      );
  };
  material.customProgramCacheKey = () => 'gcode-compact-instances-v2';
  const mesh = new THREE.Mesh(geometry, material);
  // Base vertices are only a template; model bounds are used for camera fitting.
  mesh.frustumCulled = false;
  return {
    mesh,
    setPixelHeight(height: number) {
      resolution.value = height;
    },
    setIntervals(intervals: { colored: number[]; muted: number[] }) {
      const bottom = intervals.muted[1]
        ? intervals.muted[0]
        : intervals.colored[0];
      const top = intervals.colored[0];
      const end = top + intervals.colored[1];
      range.value.set(bottom, top, end);
      geometry.instanceCount = end;
      mesh.visible = intervals.colored[1] + intervals.muted[1] > 0;
    },
  };
}

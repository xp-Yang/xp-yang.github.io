// Column-major OpenGL matrices. The grid's original vertex stage performs
// inverse(view) * inverse(projection), just as in the desktop engine.
export function gridCamera(aspect: number) {
  const yaw = Math.PI / 4;
  const pitch = Math.PI / 7;
  const radius = 16;
  const sx = Math.sin(yaw), cx = Math.cos(yaw);
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const view = new Float32Array([
    cx, -sp * sx, cp * sx, 0,
    0, cp, sp, 0,
    -sx, -sp * cx, cp * cx, 0,
    0, 0, -radius, 1,
  ]);
  const near = 0.1, far = 500;
  const f = 1 / Math.tan(50 * Math.PI / 360);
  const projection = new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, 2 * far * near / (near - far), 0,
  ]);
  return { view, projection };
}

export function gridStageSource(source: string) {
  // Desktop GLSL 330 and WebGL2 use the same matrix/derivative operations here.
  return source.replace(/^#version[^\r\n]*/, '#version 300 es\nprecision highp float;\nprecision highp int;');
}

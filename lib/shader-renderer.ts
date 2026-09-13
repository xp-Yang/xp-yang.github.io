import { gridCamera, gridStageSource } from './grid-camera';

const vertexSource = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

export function fragmentSource(source: string) {
  // ASCII comments and float literal suffixes vary in the original editor.
  // Keep the attributed originals intact; normalize only the compiler input.
  const normalized = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    .replace(/\b(\d+\.\d*)f\b/g, '$1');
  return `#version 300 es
precision highp float;
precision highp int;
uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
out vec4 outputColor;
${normalized}
void main() { mainImage(outputColor, gl_FragCoord.xy); outputColor.a = 1.0; }`;
}

export function createShaderRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  if (!gl) throw new Error('此设备无法启动 WebGL2。');
  let program: WebGLProgram | null = null;
  let uniforms: (WebGLUniformLocation | null)[] = [];
  let disposed = false;
  let isGrid = false;
  let viewUniform: WebGLUniformLocation | null = null;
  let projectionUniform: WebGLUniformLocation | null = null;
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  function compile(type: number, source: string) {
    const shader = gl!.createShader(type);
    if (!shader) throw new Error('无法分配 Shader 资源。');
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      const error = gl!.getShaderInfoLog(shader);
      gl!.deleteShader(shader);
      throw new Error(error ?? 'Shader 编译失败。');
    }
    return shader;
  }
  return {
    load(source: string, customVertex?: string) {
      if (disposed) return;
      if (program) gl.deleteProgram(program);
      program = null;
      isGrid = Boolean(customVertex);
      const vertex = compile(gl.VERTEX_SHADER, customVertex ? gridStageSource(customVertex) : vertexSource);
      let fragment: WebGLShader;
      try { fragment = compile(gl.FRAGMENT_SHADER, isGrid ? gridStageSource(source) : fragmentSource(source)); }
      catch (error) { gl.deleteShader(vertex); throw error; }
      const next = gl.createProgram();
      if (!next) { gl.deleteShader(vertex); gl.deleteShader(fragment); throw new Error('无法创建 Shader 程序。'); }
      gl.attachShader(next, vertex);
      gl.attachShader(next, fragment);
      gl.bindAttribLocation(next, 0, isGrid ? 'vertex_pos' : 'position');
      gl.linkProgram(next);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(next, gl.LINK_STATUS)) {
        const error = gl.getProgramInfoLog(next);
        gl.deleteProgram(next);
        throw new Error(error ?? 'Shader 链接失败。');
      }
      program = next;
      gl.useProgram(program);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      uniforms = ['iResolution', 'iTime', 'iMouse'].map(name => gl.getUniformLocation(next, name));
      viewUniform = gl.getUniformLocation(next, 'view');
      projectionUniform = gl.getUniformLocation(next, 'proj');
    },
    draw(width: number, height: number, time: number, mouse: number[] = [0, 0, 0, 0]) {
      if (disposed || !program || gl.isContextLost()) return;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      if (isGrid) {
        const camera = gridCamera(width / height);
        gl.uniformMatrix4fv(viewUniform, false, camera.view);
        gl.uniformMatrix4fv(projectionUniform, false, camera.projection);
        // The desktop grid outputs coverage in alpha; composite over the
        // viewport background instead of discarding that coverage.
        gl.clearColor(0.025, 0.03, 0.04, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      } else {
        gl.disable(gl.BLEND);
      }
      gl.uniform3f(uniforms[0], width, height, 1);
      gl.uniform1f(uniforms[1], time);
      gl.uniform4f(uniforms[2], mouse[0], mouse[1], mouse[2], mouse[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose(loseContext = false) {
      if (disposed) return;
      disposed = true;
      if (program) gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      if (loseContext) gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

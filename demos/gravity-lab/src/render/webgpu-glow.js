const FULLSCREEN = /* wgsl */ `
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vertex(@builtin(vertex_index) index: u32) -> Vertex {
  let corners = array<vec2<f32>, 3>(vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
  var out: Vertex;
  out.position = vec4(corners[index],0.,1.);
  out.uv = corners[index] * vec2(.5,-.5) + .5;
  return out;
}
`;

export const DOWNSAMPLE = FULLSCREEN + /* wgsl */ `
@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var source: texture_2d<f32>;
fn tent(uv: vec2<f32>) -> vec3<f32> {
  let texel = 1. / vec2<f32>(textureDimensions(source));
  var light = vec3<f32>(0.);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let weight = select(1.,2.,x == 0) * select(1.,2.,y == 0);
      light += textureSampleLevel(source,linearSampler,uv+vec2<f32>(f32(x),f32(y))*texel,0.).rgb * weight;
    }
  }
  return light / 16.;
}
@fragment fn extract(v: Vertex) -> @location(0) vec4<f32> {
  let light = tent(v.uv);
  let brightness = max(max(light.r,light.g),light.b);
  let knee = clamp(brightness-.8+.4,0.,.8);
  let contribution = max(brightness-.8,knee*knee/1.6) / max(brightness,.00001);
  return vec4(light*contribution,1.);
}
@fragment fn downsample(v: Vertex) -> @location(0) vec4<f32> {
  return vec4(tent(v.uv),1.);
}
`;

// Five-sigma support keeps intense HDR clusters from exposing a square kernel
// cutoff. Pair adjacent taps to perform the 17-tap Gaussian in nine reads.
export const GAUSSIAN = FULLSCREEN + /* wgsl */ `
@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var source: texture_2d<f32>;
fn gaussian(uv: vec2<f32>, axis: vec2<f32>) -> vec3<f32> {
  let direction = axis / vec2<f32>(textureDimensions(source));
  var light = textureSampleLevel(source,linearSampler,uv,0.).rgb * .249338942414;
  light += (textureSampleLevel(source,linearSampler,uv+direction*1.357567522370,0.).rgb
    + textureSampleLevel(source,linearSampler,uv-direction*1.357567522370,0.).rgb) * .319256305688;
  light += (textureSampleLevel(source,linearSampler,uv+direction*3.203074628189,0.).rgb
    + textureSampleLevel(source,linearSampler,uv-direction*3.203074628189,0.).rgb) * .053946613914;
  light += (textureSampleLevel(source,linearSampler,uv+direction*5.104477323130,0.).rgb
    + textureSampleLevel(source,linearSampler,uv-direction*5.104477323130,0.).rgb) * .002109283719;
  light += (textureSampleLevel(source,linearSampler,uv+direction*7.050705364798,0.).rgb
    + textureSampleLevel(source,linearSampler,uv-direction*7.050705364798,0.).rgb) * .000018325472;
  return light;
}
@fragment fn horizontal(v: Vertex) -> @location(0) vec4<f32> {
  return vec4(gaussian(v.uv,vec2(1.,0.)),1.);
}
@fragment fn vertical(v: Vertex) -> @location(0) vec4<f32> {
  return vec4(gaussian(v.uv,vec2(0.,1.)),1.);
}
`;

export const COMPOSITE = FULLSCREEN + /* wgsl */ `
@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var bloom0: texture_2d<f32>;
@group(0) @binding(3) var bloom1: texture_2d<f32>;
@group(0) @binding(4) var bloom2: texture_2d<f32>;
@group(0) @binding(5) var bloom3: texture_2d<f32>;
fn toneMap(light: vec3<f32>) -> vec3<f32> {
  // Limit the argument before the quadratic to avoid f16 overflow propagating
  // through extremely dense projections; 64 already maps to display white.
  let x = clamp(light*.9,vec3<f32>(0.),vec3<f32>(64.));
  return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3<f32>(0.),vec3<f32>(1.));
}
@fragment fn fragment(v: Vertex) -> @location(0) vec4<f32> {
  let glow = textureSampleLevel(bloom0,linearSampler,v.uv,0.).rgb*.22
    + textureSampleLevel(bloom1,linearSampler,v.uv,0.).rgb*.3
    + textureSampleLevel(bloom2,linearSampler,v.uv,0.).rgb*.45
    + textureSampleLevel(bloom3,linearSampler,v.uv,0.).rgb*.6;
  let hdr = textureSampleLevel(scene,linearSampler,v.uv,0.).rgb + glow*.85;
  let linear = toneMap(hdr);
  let srgb = select(linear*12.92,1.055*pow(linear,vec3<f32>(1./2.4))-.055,linear>vec3<f32>(.0031308));
  return vec4(srgb,1.);
}
`;

/** Linear HDR accumulation and a bounded four-level bloom, entirely on GPU. */
export async function createGpuGlow(device, canvasFormat) {
  const down = device.createShaderModule({ code: DOWNSAMPLE, label: 'Cluster glow downsample' });
  const blur = device.createShaderModule({ code: GAUSSIAN, label: 'Cluster glow Gaussian' });
  const composite = device.createShaderModule({ code: COMPOSITE, label: 'Cluster glow composite' });
  const pipeline = (module, entryPoint, format) => device.createRenderPipelineAsync({
    layout: 'auto', vertex: { module, entryPoint: 'vertex' },
    fragment: { module, entryPoint, targets: [{ format }] }, primitive: { topology: 'triangle-list' },
  });
  const [extract, downsample, horizontal, vertical, finish] = await Promise.all([
    pipeline(down, 'extract', 'rgba16float'), pipeline(down, 'downsample', 'rgba16float'),
    pipeline(blur, 'horizontal', 'rgba16float'), pipeline(blur, 'vertical', 'rgba16float'),
    pipeline(composite, 'fragment', canvasFormat),
  ]);
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  let textures = [], sceneView, levels = [], finishBindings, width = 0, height = 0;
  const retire = old => { void device.queue.onSubmittedWorkDone().catch(() => {}).then(() => old.forEach(texture => texture.destroy())); };
  function bindings(renderPipeline, inputs) {
    return device.createBindGroup({ layout: renderPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: sampler }, ...inputs.map((resource, i) => ({ binding: i+1, resource })),
    ] });
  }
  function texture(w, h) {
    const target = device.createTexture({ label: 'Cluster light', size: [w,h], format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    textures.push(target);
    return target.createView();
  }
  return {
    get sceneView() { return sceneView; },
    resize(w, h) {
      if (w === width && h === height) return;
      retire(textures); textures = []; levels = []; width = w; height = h;
      sceneView = texture(w,h);
      let previous = sceneView;
      for (let i=0; i<4; i++) {
        w = Math.max(1,Math.ceil(w/2)); h = Math.max(1,Math.ceil(h/2));
        const renderPipeline = i === 0 ? extract : downsample;
        const view = texture(w,h);
        const scratch = texture(w,h), filtered = texture(w,h);
        levels.push({ filtered, passes: [
          { view, pipeline: renderPipeline, bindings: bindings(renderPipeline,[previous]) },
          { view: scratch, pipeline: horizontal, bindings: bindings(horizontal,[view]) },
          { view: filtered, pipeline: vertical, bindings: bindings(vertical,[scratch]) },
        ] });
        // Build the next level from raw light, not already blurred light.
        previous = view;
      }
      finishBindings = bindings(finish,[sceneView,...levels.map(level => level.filtered)]);
    },
    encode(encoder, canvasView, timestampWrites) {
      for (const level of levels) for (const stage of level.passes) {
        const pass = encoder.beginRenderPass({ label: 'Cluster glow filter', colorAttachments: [
          { view: stage.view, clearValue: [0,0,0,0], loadOp: 'clear', storeOp: 'store' },
        ] });
        pass.setPipeline(stage.pipeline); pass.setBindGroup(0,stage.bindings); pass.draw(3); pass.end();
      }
      const pass = encoder.beginRenderPass({ label: 'Cluster glow tone mapping', timestampWrites,
        colorAttachments: [{ view: canvasView, clearValue: [0,0,0,1], loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(finish); pass.setBindGroup(0,finishBindings); pass.draw(3); pass.end();
    },
    dispose() { retire(textures); textures = []; levels = []; },
  };
}

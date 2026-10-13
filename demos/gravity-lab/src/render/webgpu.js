import { createCanvas, createView } from './view.js';
import { createGpuGlow } from './webgpu-glow.js';

const PARTICLES = /* wgsl */ `
struct Camera { matrix: mat4x4<f32>, size: vec4<f32>, scale: vec4<f32> }
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> hi: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> lo: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> control: array<u32>;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vertex(@builtin(vertex_index) vertexId: u32, @builtin(instance_index) body: u32) -> Vertex {
  let corners = array<vec2<f32>,6>(vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
  let index = control[0] * u32(camera.scale.x) + body;
  let p = camera.matrix * vec4(hi[index].xyz,1.) + camera.matrix * vec4(lo[index].xyz,0.);
  let diameter = camera.size.w * camera.size.y * camera.scale.y / max(p.w,.0001) * .55;
  let pointSize = clamp(diameter,4.8*camera.size.w*camera.size.z,96.*camera.size.w*camera.size.z)*6.;
  var out: Vertex;
  out.position = vec4(p.xy + corners[vertexId] * pointSize / camera.size.xy * p.w,(p.z+p.w)*.5,p.w);
  out.uv = corners[vertexId];
  return out;
}
@fragment fn fragment(v: Vertex) -> @location(0) vec4<f32> {
  let d = length(v.uv);
  let aa = max(fwidth(d)*.5,.001);
  let core = 1. - smoothstep(.14-aa,.19+aa,d);
  let edge = 1. - smoothstep(.65,1.,d);
  let light = vec3<f32>(.93,.96,1.)*(core*2.8+exp(-d*d*18.)*.24+exp(-d*d*5.5)*.045)*edge;
  if (max(max(light.r,light.g),light.b) < .0001) { discard; }
  return vec4(light,1.);
}`;
const HISTORY = /* wgsl */ `
@group(0) @binding(0) var<storage, read> hi: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> lo: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> control: array<u32>;
@group(0) @binding(3) var<storage, read_write> history: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> trailState: array<u32>;
@compute @workgroup_size(128) fn sample(@builtin(global_invocation_id) id: vec3<u32>) {
  let count = arrayLength(&hi) / 2u;
  if (id.x >= count || control[1] == trailState[2]) { return; }
  let i = control[0]*count+id.x;
  history[id.x*64u+trailState[0]] = vec4(hi[i].xyz+lo[i].xyz,1.);
}
@compute @workgroup_size(1) fn commit() {
  if (control[1] == trailState[2]) { return; }
  trailState[0] = (trailState[0]+1u)%64u;
  trailState[1] = min(64u,trailState[1]+1u);
  trailState[2] = control[1];
}`;
const TRAILS = /* wgsl */ `
struct Camera { matrix: mat4x4<f32>, size: vec4<f32>, scale: vec4<f32> }
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> history: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> trailState: array<u32>;
@vertex fn vertex(@builtin(vertex_index) id: u32) -> @builtin(position) vec4<f32> {
  let body = id / 126u;
  let segment = (id % 126u) / 2u;
  if (segment+1u >= trailState[1]) { return vec4(2.,2.,2.,1.); }
  let sample = (trailState[0]+64u-trailState[1]+segment+(id%2u))%64u;
  let p = camera.matrix*vec4(history[body*64u+sample].xyz,1.);
  return vec4(p.xy,(p.z+p.w)*.5,p.w);
}
@fragment fn fragment() -> @location(0) vec4<f32> { return vec4(241./255.,245./255.,1.,.045); }
`;

/** Both native GPU states and CPU uploads use the same draw/history shaders. */
export async function createGpuRenderer(host, device, callbacks = {}, saved) {
  const canvas = createCanvas(host);
  const context = canvas.getContext('webgpu');
  if (!context) { canvas.remove(); throw new Error('WebGPU 画布不可用'); }
  const view = createView(host, canvas, callbacks, saved);
  const format = navigator.gpu.getPreferredCanvasFormat();
  const U = GPUBufferUsage;
  const uniform = device.createBuffer({size:96,usage:U.UNIFORM|U.COPY_DST});
  const shader = device.createShaderModule({code:PARTICLES,label:'Direct resident particle rendering'});
  const trails = device.createShaderModule({code:TRAILS});
  const historyShader = device.createShaderModule({code:HISTORY});
  const blend = {color:{srcFactor:'src-alpha',dstFactor:'one',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}};
  let pipelines, compileTimeout;
  try {
    pipelines = await Promise.race([Promise.all([
      device.createRenderPipelineAsync({layout:'auto',vertex:{module:shader,entryPoint:'vertex'},fragment:{module:shader,entryPoint:'fragment',targets:[{format:'rgba16float',blend}]},primitive:{topology:'triangle-list'}}),
      device.createRenderPipelineAsync({layout:'auto',vertex:{module:trails,entryPoint:'vertex'},fragment:{module:trails,entryPoint:'fragment',targets:[{format:'rgba16float',blend}]},primitive:{topology:'line-list'}}),
      device.createComputePipelineAsync({layout:'auto',compute:{module:historyShader,entryPoint:'sample'}}),
      device.createComputePipelineAsync({layout:'auto',compute:{module:historyShader,entryPoint:'commit'}}),
      createGpuGlow(device,format),
    ]),new Promise((_,reject)=>{compileTimeout=setTimeout(()=>reject(new Error('WebGPU 绘制管线初始化超时。')),15000);})]);
    context.configure({device,format,alphaMode:'opaque'});
  } catch(error) { uniform.destroy(); view.dispose(); canvas.remove(); throw error; }
  finally {clearTimeout(compileTimeout);}
  const [particlePipeline,trailPipeline,samplePipeline,historyCommit,glow] = pipelines;
  let source, particleBindings, history, historyMeta, sampleBindings, commitBindings, trailBindings;
  let enabled = false, lastTrailAt = 0, owned = [], disposed = false;
  const buffer = (size,usage) => device.createBuffer({size,usage});
  const bind = (pipeline,buffers) => device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:buffers.map(([binding,b])=>({binding,resource:{buffer:b}}))});
  function retire(buffers) { device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>buffers.forEach(b=>b?.destroy())); }
  function resetTrails() {
    if (historyMeta) device.queue.writeBuffer(historyMeta,0,new Uint32Array([0,0,0xffffffff,0]));
    lastTrailAt=0;
  }
  function rebuildHistory() {
    retire([history,historyMeta]); history=historyMeta=null;
    if (!enabled || !source) return;
    history=buffer(source.count*64*16,U.STORAGE);
    historyMeta=buffer(16,U.STORAGE|U.COPY_DST);
    sampleBindings=bind(samplePipeline,[[0,source.positionHi],[1,source.positionLo],[2,source.control],[3,history],[4,historyMeta]]);
    commitBindings=bind(historyCommit,[[2,source.control],[4,historyMeta]]);
    trailBindings=bind(trailPipeline,[[0,uniform],[1,history],[2,historyMeta]]);
    resetTrails();
  }
  function setSource(next) {
    if(!next.cpu && owned.length){retire(owned);owned=[];}
    source=next;
    particleBindings=bind(particlePipeline,[[0,uniform],[1,source.positionHi],[2,source.positionLo],[3,source.control]]);
    rebuildHistory();
  }
  return {
    kind:'webgpu', view, setSource,
    setBounds:(b,r)=>view.setBounds(b,r),
    setSnapshot(positions, meta) {
      if (!source?.cpu || source.count!==meta.count) {
        retire(owned);
        owned=[buffer(meta.count*2*16,U.STORAGE|U.COPY_DST),buffer(meta.count*2*16,U.STORAGE|U.COPY_DST),buffer(16,U.STORAGE|U.COPY_DST)];
        setSource({positionHi:owned[0],positionLo:owned[1],control:owned[2],count:meta.count,radius:meta.radius,origin:[0,0,0],cpu:true});
      }
      const packed=new Float32Array(meta.count*4);
      for(let i=0;i<meta.count;i++) packed.set(positions.subarray(i*3,i*3+3),i*4);
      device.queue.writeBuffer(source.positionHi,0,packed);
      device.queue.writeBuffer(source.control,0,new Uint32Array([0,meta.acceptedSteps||0,0,0]));
      if(meta.bounds) view.setBounds(meta.bounds,meta.radius);
    },
    setTrails(value) { if(enabled!==Boolean(value)){enabled=Boolean(value);rebuildHistory();} },
    resetTrails,
    setQuality:value=>view.setQuality(value),
    fit:()=>view.fit(),
    saveCamera:()=>view.save(),
    update:now=>view.update(now),
    encode(encoder,now,timestampWrites) {
      if(disposed || !source)return;
      if(canvas.width!==view.width||canvas.height!==view.height){canvas.width=view.width;canvas.height=view.height;}
      glow.resize(canvas.width,canvas.height);
      const camera=new Float32Array(24);
      camera.set(view.projection(source.origin),0);
      camera.set([canvas.width,canvas.height,view.pixelRatio,source.radius],16);
      camera.set([source.count,view.camera.projectionMatrix.elements[5],0,0],20);
      device.queue.writeBuffer(uniform,0,camera);
      if(history && now-lastTrailAt>=75){
        const pass=encoder.beginComputePass({label:'Resident trail sample'});
        pass.setPipeline(samplePipeline);pass.setBindGroup(0,sampleBindings);pass.dispatchWorkgroups(Math.ceil(source.count/128));
        pass.setPipeline(historyCommit);pass.setBindGroup(0,commitBindings);pass.dispatchWorkgroups(1);pass.end();
        lastTrailAt=now;
      }
      // Span the scene, bloom and composite passes with the existing two queries.
      const beginTimestamp=timestampWrites?{querySet:timestampWrites.querySet,beginningOfPassWriteIndex:timestampWrites.beginningOfPassWriteIndex}:undefined;
      const endTimestamp=timestampWrites?{querySet:timestampWrites.querySet,endOfPassWriteIndex:timestampWrites.endOfPassWriteIndex}:undefined;
      const pass=encoder.beginRenderPass({label:'Linear particle light',timestampWrites:beginTimestamp,colorAttachments:[{view:glow.sceneView,clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store'}]});
      if(history){pass.setPipeline(trailPipeline);pass.setBindGroup(0,trailBindings);pass.draw(source.count*126);}
      pass.setPipeline(particlePipeline);pass.setBindGroup(0,particleBindings);pass.draw(6,source.count);pass.end();
      glow.encode(encoder,context.getCurrentTexture().createView(),endTimestamp);
      view.rendered(now);
    },
    dispose() {
      if(disposed)return;disposed=true;
      glow.dispose();retire([uniform,history,historyMeta,...owned]);view.dispose();context.unconfigure();canvas.remove();
    },
  };
}

import * as THREE from 'three';
import { createCanvas, createView } from './view.js';
import { PARTICLE_RADIUS } from '../physics/constants.js';

const TONE_MAPPING = /* glsl */ `
  vec3 displayRadiance(vec3 value) {
    vec3 x = clamp(value * .9, vec3(0.), vec3(64.));
    return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.);
  }
`;
const POST_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
`;
const BLOOM_FRAGMENT = /* glsl */ `
  uniform sampler2D source;
  uniform vec2 texel;
  uniform bool threshold;
  varying vec2 vUv;
  void main() {
    vec3 sum = vec3(0.);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        float weight = (x == 0 ? 2. : 1.) * (y == 0 ? 2. : 1.);
        sum += texture2D(source, vUv + vec2(float(x), float(y)) * texel).rgb * weight;
      }
    }
    sum *= 1. / 16.;
    if (threshold) {
      float brightness = max(max(sum.r, sum.g), sum.b);
      float soft = clamp(brightness - .8 + .4, 0., .8);
      float contribution = max(brightness - .8, soft * soft / 1.6);
      sum *= contribution / max(brightness, .00001);
    }
    gl_FragColor = vec4(sum, 1.);
  }
`;
// A five-sigma Gaussian tail prevents HDR tone mapping from revealing a square
// cutoff around bright clusters. Adjacent taps share one bilinear texture read.
const BLUR_FRAGMENT = /* glsl */ `
  uniform sampler2D source;
  uniform vec2 direction;
  varying vec2 vUv;
  void main() {
    vec3 sum = texture2D(source, vUv).rgb * .249338942414;
    sum += (texture2D(source, vUv + direction * 1.357567522370).rgb
      + texture2D(source, vUv - direction * 1.357567522370).rgb) * .319256305688;
    sum += (texture2D(source, vUv + direction * 3.203074628189).rgb
      + texture2D(source, vUv - direction * 3.203074628189).rgb) * .053946613914;
    sum += (texture2D(source, vUv + direction * 5.104477323130).rgb
      + texture2D(source, vUv - direction * 5.104477323130).rgb) * .002109283719;
    sum += (texture2D(source, vUv + direction * 7.050705364798).rgb
      + texture2D(source, vUv - direction * 7.050705364798).rgb) * .000018325472;
    gl_FragColor = vec4(sum, 1.);
  }
`;
const COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D source;
  uniform sampler2D bloom0;
  uniform sampler2D bloom1;
  uniform sampler2D bloom2;
  uniform sampler2D bloom3;
  varying vec2 vUv;
  ${TONE_MAPPING}
  void main() {
    vec3 bloom = texture2D(bloom0, vUv).rgb * .22
      + texture2D(bloom1, vUv).rgb * .30
      + texture2D(bloom2, vUv).rgb * .45
      + texture2D(bloom3, vUv).rgb * .60;
    vec3 color = displayRadiance(texture2D(source, vUv).rgb + bloom * .85);
    gl_FragColor = vec4(color, 1.);
    #include <colorspace_fragment>
  }
`;

/** Accumulate light before tone mapping; dense clusters retain their extra light. */
function createBloom(renderer) {
  if (!renderer.extensions.has('EXT_color_buffer_float')) return null;
  const target = () => new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  const source = target(), levels = Array.from({length:4}, target);
  const scratch = Array.from({length:4}, target), filtered = Array.from({length:4}, target);
  const downsample = new THREE.ShaderMaterial({
    uniforms: {source:{value:null}, texel:{value:new THREE.Vector2()}, threshold:{value:false}},
    vertexShader: POST_VERTEX, fragmentShader: BLOOM_FRAGMENT,
    depthTest:false, depthWrite:false, toneMapped:false,
  });
  const blur = new THREE.ShaderMaterial({
    uniforms: {source:{value:null}, direction:{value:new THREE.Vector2()}},
    vertexShader: POST_VERTEX, fragmentShader: BLUR_FRAGMENT,
    depthTest:false, depthWrite:false, toneMapped:false,
  });
  const composite = new THREE.ShaderMaterial({
    uniforms: {source:{value:source.texture}, ...Object.fromEntries(filtered.map((level, i) => [`bloom${i}`, {value:level.texture}]))},
    vertexShader: POST_VERTEX, fragmentShader: COMPOSITE_FRAGMENT,
    depthTest:false, depthWrite:false, toneMapped:false,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0,0,2,0,0,2], 2));
  const screen = new THREE.Scene(), camera = new THREE.Camera(), triangle = new THREE.Mesh(geometry, downsample);
  triangle.frustumCulled = false; screen.add(triangle);
  return {
    resize(width, height) {
      if (source.width === width && source.height === height) return;
      source.setSize(width, height);
      for (let i = 0; i < levels.length; i++) {
        const levelWidth = Math.max(1, Math.ceil(width / 2 ** (i + 1)));
        const levelHeight = Math.max(1, Math.ceil(height / 2 ** (i + 1)));
        levels[i].setSize(levelWidth, levelHeight);
        scratch[i].setSize(levelWidth, levelHeight);
        filtered[i].setSize(levelWidth, levelHeight);
      }
    },
    render(scene, sceneCamera) {
      renderer.setClearColor(0, 1);
      renderer.setRenderTarget(source);
      renderer.render(scene, sceneCamera);
      triangle.material = downsample;
      let previous = source;
      for (let i = 0; i < levels.length; i++) {
        downsample.uniforms.source.value = previous.texture;
        downsample.uniforms.texel.value.set(1 / previous.width, 1 / previous.height);
        downsample.uniforms.threshold.value = i === 0;
        renderer.setRenderTarget(levels[i]);
        renderer.render(screen, camera);
        previous = levels[i];
      }
      // Keep the downsample chain independent of the blur. Each octave then has
      // an explicit Gaussian footprint, rather than visible low-resolution texels.
      triangle.material = blur;
      for (let i = 0; i < levels.length; i++) {
        blur.uniforms.source.value = levels[i].texture;
        blur.uniforms.direction.value.set(1 / levels[i].width, 0);
        renderer.setRenderTarget(scratch[i]);
        renderer.render(screen, camera);
        blur.uniforms.source.value = scratch[i].texture;
        blur.uniforms.direction.value.set(0, 1 / levels[i].height);
        renderer.setRenderTarget(filtered[i]);
        renderer.render(screen, camera);
      }
      triangle.material = composite;
      renderer.setRenderTarget(null);
      renderer.render(screen, camera);
    },
    dispose() {
      source.dispose(); levels.forEach(level => level.dispose());
      scratch.forEach(level => level.dispose()); filtered.forEach(level => level.dispose());
      geometry.dispose(); downsample.dispose(); blur.dispose(); composite.dispose(); screen.clear();
    },
  };
}

/** Compatibility renderer. Only CPU snapshots reach this adapter. */
export function createWebGLRenderer(host, callbacks = {}, saved) {
  const canvas=createCanvas(host);
  let renderer;
  try { renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'}); }
  catch(error){canvas.remove();throw error;}
  renderer.setClearColor(0x000000,1);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.NoToneMapping;
  const view=createView(host,canvas,callbacks,saved), scene=new THREE.Scene();
  let bloom=createBloom(renderer);
  const material=new THREE.ShaderMaterial({
    uniforms:{radius:{value:PARTICLE_RADIUS},height:{value:1},ratio:{value:1},hdr:{value:Boolean(bloom)}},
    vertexShader:`uniform float radius;uniform float height;uniform float ratio;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.);float d=radius*height*projectionMatrix[1][1]/max(-p.z,.0001)*.55;
      gl_PointSize=clamp(d,4.8*radius*ratio,96.*radius*ratio)*6.;gl_Position=projectionMatrix*p;}`,
    fragmentShader:`uniform bool hdr;
      ${TONE_MAPPING}
      void main(){float r=length(gl_PointCoord*2.-1.);float aa=max(fwidth(r)*.5,.001);
      float core=1.-smoothstep(.14-aa,.19+aa,r);float edge=1.-smoothstep(.65,1.,r);
      vec3 light=vec3(.93,.96,1.)*(core*2.8+exp(-r*r*18.)*.24+exp(-r*r*5.5)*.045)*edge;
      if(max(max(light.r,light.g),light.b)<.0001)discard;
      gl_FragColor=vec4(hdr?light:displayRadiance(light),1.);
      #include <colorspace_fragment>
      }`,
    transparent:true,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false,toneMapped:false,
  });
  const lineMaterial=new THREE.LineBasicMaterial({color:0xf1f5ff,transparent:true,opacity:bloom ? .045 : .16,depthWrite:false});
  let geometry,mesh,lines,lineGeometry,count=0,positions=new Float32Array(0);
  let trailHistory,trailVertices,write=0,samples=0,lastSampleAt=0,lastSampleStep=-1;
  let trails=false,lost=false,disposed=false;
  function resetTrails(){write=samples=lastSampleAt=0;lastSampleStep=-1;lineGeometry?.setDrawRange(0,0);}
  function rebuildTrails(){
    if(lines)scene.remove(lines);lineGeometry?.dispose();lines=lineGeometry=null;
    trailHistory=trailVertices=null;resetTrails();
    if(!trails||!count)return;
    trailHistory=new Float32Array(count*64*3);trailVertices=new Float32Array(count*63*6);
    lineGeometry=new THREE.BufferGeometry();
    lineGeometry.setAttribute('position',new THREE.BufferAttribute(trailVertices,3).setUsage(THREE.DynamicDrawUsage));
    lineGeometry.setDrawRange(0,0);lines=new THREE.LineSegments(lineGeometry,lineMaterial);lines.frustumCulled=false;scene.add(lines);
  }
  function sample(step){
    const now=performance.now();
    if(!trailHistory||lastSampleStep===step||now-lastSampleAt<75)return;
    lastSampleAt=now;lastSampleStep=step;
    for(let i=0;i<count;i++)trailHistory.set(positions.subarray(i*3,i*3+3),(i*64+write)*3);
    write=(write+1)%64;samples=Math.min(samples+1,64);
    let offset=0;
    for(let i=0;i<count;i++)for(let j=1;j<samples;j++){
      const a=(write-samples+j-1+64)%64,b=(a+1)%64;
      trailVertices.set(trailHistory.subarray((i*64+a)*3,(i*64+a)*3+3),offset);offset+=3;
      trailVertices.set(trailHistory.subarray((i*64+b)*3,(i*64+b)*3+3),offset);offset+=3;
    }
    lineGeometry.attributes.position.needsUpdate=true;lineGeometry.setDrawRange(0,offset/3);
  }
  function loss(event){event.preventDefault();lost=true;callbacks.onContextState?.(false);}
  function restore(){
    bloom?.dispose();bloom=createBloom(renderer);material.uniforms.hdr.value=Boolean(bloom);lineMaterial.opacity=bloom ? .045 : .16;
    lost=false;if(geometry)geometry.attributes.position.needsUpdate=true;if(lineGeometry)lineGeometry.attributes.position.needsUpdate=true;callbacks.onContextState?.(true);
  }
  canvas.addEventListener('webglcontextlost',loss);canvas.addEventListener('webglcontextrestored',restore);
  return {
    kind:'webgl',view,
    setSnapshot(next,meta){
      if(count!==meta.count){
        count=meta.count;positions=new Float32Array(count*3);
        if(mesh)scene.remove(mesh);geometry?.dispose();geometry=new THREE.BufferGeometry();
        geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
        mesh=new THREE.Points(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=1;scene.add(mesh);rebuildTrails();
      }
      positions.set(next);geometry.attributes.position.needsUpdate=true;
      material.uniforms.radius.value=meta.radius;
      view.setBounds(meta.bounds,meta.radius);sample(meta.acceptedSteps);
    },
    setBounds:(b,r)=>view.setBounds(b,r),
    setTrails(value){if(trails!==Boolean(value)){trails=Boolean(value);rebuildTrails();}},
    resetTrails,setQuality:value=>view.setQuality(value),fit:()=>view.fit(),saveCamera:()=>view.save(),update:now=>view.update(now),
    render(now){
      if(disposed||lost)return;
      if(canvas.width!==view.width||canvas.height!==view.height)renderer.setSize(view.width,view.height,false);
      material.uniforms.height.value=view.height;material.uniforms.ratio.value=view.pixelRatio;
      if(bloom){bloom.resize(view.width,view.height);bloom.render(scene,view.camera);}
      else{renderer.setClearColor(0x000000,1);renderer.setRenderTarget(null);renderer.render(scene,view.camera);}
      view.rendered(now);
    },
    dispose(){if(disposed)return;disposed=true;canvas.removeEventListener('webglcontextlost',loss);canvas.removeEventListener('webglcontextrestored',restore);
      view.dispose();geometry?.dispose();lineGeometry?.dispose();material.dispose();lineMaterial.dispose();bloom?.dispose();scene.clear();renderer.dispose();canvas.remove();},
  };
}

import { createGpuRenderer } from '../render/webgpu.js';
import { createGpuEngine } from '../gpu/engine.js';
import { createGpuTiming } from '../gpu/timing.js';
import { FIXED_TIMESTEP as DT } from '../physics/timestep.js';

// Requests are tagged with a scene epoch. Retiring a worker rejects its pending
// requests; late results can never overwrite a newer Apply operation.
function workerClient(worker) {
  let sequence = 0, closed = false;
  const pending = new Map();
  function fail(error) {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  }
  worker.onmessage = ({data}) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id); clearTimeout(request.timer);
    if (data.ok) request.resolve(data); else request.reject(new Error(data.error));
  };
  worker.onerror = event => fail(new Error(event.message || '计算线程意外退出。'));
  return {
    request(epoch, type, payload = {}) {
      if (closed) return Promise.reject(new Error('计算线程已关闭。'));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('计算线程响应超时。')); }, 120000);
        pending.set(id, {resolve,reject,timer});
        worker.postMessage({id,epoch,type,...payload});
      });
    },
    dispose() { closed=true; worker.terminate(); fail(new Error('计算线程已关闭。')); },
  };
}
const cpuClient = () => workerClient(new Worker(new URL('../workers/cpu.worker.js', import.meta.url), {type:'module'}));
const referenceClient = () => workerClient(new Worker(new URL('../diagnostics/reference.worker.js', import.meta.url), {type:'module'}));
const message = error => error instanceof Error ? error.message : String(error);
function bounded(promise, milliseconds, label) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(`${label}超时。`)),milliseconds);
  })]).finally(()=>clearTimeout(timer));
}
function snapshotForReference(snapshot, config) {
  return {...snapshot, config, precision:snapshot.forcePrecision === 'f32' ? 'f32' : snapshot.precision,
    accelerations:snapshot.accelerations ?? snapshot.sampleAccelerations};
}

/**
 * The only animation clock, queue owner and authority for the applied scene.
 * @param {HTMLElement} host
 * @param {{onUpdate?: (update: object) => void, onError?: (message: string) => void, signal?: AbortSignal}} options
 */
export async function createRuntime(host, {onUpdate = (_update) => {}, onError = (_message) => {},signal} = {}) {
  let disposed=false, generation=0, scene=null, renderer=null, device=null;
  let gpuUnavailable='', recovering=false, recoveryPromise=null, graphicsReady=true, preparingEpoch=null;
  let paused=false, speed=1, trails=false, quality='auto', diagnosticsVisible=false;
  let debt=0, targetStep=0, freeEncodedStep=0, manualTarget=null, controlSerial=0, synchronizing=false;
  let lastFrame=performance.now(), frameId=0, inFlight=0;
  let timing=null,lastTiming=0;
  const candidates=new Map();
  let speedAt=lastFrame, speedTime=0, actualSpeed=0;
  const emit = update => { if(!disposed) onUpdate(update); };
  const aborted=()=>new DOMException('页面已关闭。','AbortError');
  function dispose() {
    if(disposed)return;disposed=true;generation++;cancelAnimationFrame(frameId);document.removeEventListener('visibilitychange',visibility);
    signal?.removeEventListener('abort',dispose);
    for(const candidate of candidates.values())candidate.dispose();candidates.clear();
    retire(scene);scene=null;renderer?.dispose();timing?.dispose();
    // On page teardown there is no frame to preserve. Destroying the device
    // also releases pending maps/queue promises even if the driver stalled.
    const retiredDevice=device;device=null;retiredDevice?.destroy();
  }
  signal?.addEventListener('abort',dispose,{once:true});
  if(signal?.aborted){dispose();throw aborted();}
  const callbacks = {
    onFps:fps=>emit({fps}),
    onContextState:ready=>{ graphicsReady=ready; resetClock();discardUnsubmitted();
      if(!ready) onError('绘图上下文暂时丢失，模拟已挂起，等待图形恢复。');
      else onError(''); },
  };
  const isCurrent = current => !disposed && current === scene;
  function retire(current) {
    if(!current) return;
    current.cpu.dispose(); current.reference?.dispose();
    // Old encoders may still reference an engine after Apply changes the scene.
    const engine=current.engine;
    if(engine)void engine.dispose();
  }
  function resetClock() { debt=0; lastFrame=performance.now(); speedAt=lastFrame; speedTime=scene?.meta.time || 0; actualSpeed=0; }
  function acceptMetadata(current, meta) {
    if(!isCurrent(current) || meta.acceptedSteps < current.meta.acceptedSteps) return;
    current.meta={...current.meta,...meta};
    renderer?.setBounds(meta.bounds,meta.radius);
    const now=performance.now();
    if(now-speedAt>=500){ actualSpeed=Math.max(0,(meta.time-speedTime)/((now-speedAt)/1000));speedTime=meta.time;speedAt=now; }
    if(manualTarget!==null && meta.acceptedSteps>=manualTarget) manualTarget=null;
    if(meta.status==='stopped'){
      paused=true;manualTarget=null;debt=0;
      if(current.failure!==meta.detail){current.failure=meta.detail;onError(meta.detail || '物理计算已停止，请修改初态后应用。');}
    }
    emit({time:meta.time,collisions:meta.collisions,count:meta.count,paused,status:meta.status,
      detail:meta.detail || '',actualSpeed:paused?0:actualSpeed});
  }
  function ensureBaseline(current) {
    current.reference ||= referenceClient();
    current.baselinePromise ||= current.reference.request(current.epoch,'baseline',{
      snapshot:current.initial,config:current.config,
    }).then(result=>{if(isCurrent(current))current.baseline=result.baseline;return result.baseline;});
    return current.baselinePromise;
  }
  async function diagnose(current, snapshot) {
    if(!isCurrent(current) || !diagnosticsVisible || current.referenceBusy) return;
    current.referenceBusy=true;
    const revision=current.revision;
    try {
      await ensureBaseline(current);
      if(!isCurrent(current)||revision!==current.revision||!diagnosticsVisible)return;
      const result=await current.reference.request(current.epoch,'sample',{
        snapshot:snapshotForReference(snapshot,current.config),config:current.config,baseline:current.baseline,
      });
      if(isCurrent(current) && revision===current.revision && diagnosticsVisible)emit({diagnostics:result.diagnostics});
    } catch(error) { if(isCurrent(current))emit({detail:`数值观察：${message(error)}`}); }
    finally { current.referenceBusy=false; }
  }
  function receiveCapture(current, capture) {
    const revision=current.revision;
    const promise=bounded(capture.read(),15000,'GPU 快照').then(snapshot=>{
      if(!isCurrent(current)||revision!==current.revision)return snapshot;
      acceptMetadata(current,snapshot);
      if(capture.full){
        // This copy stays owned by recovery. Worker messages clone it rather
        // than transferring/detaching the only surviving checkpoint.
        current.checkpoint=snapshotForReference(snapshot,current.config);
        void diagnose(current,current.checkpoint);
      }
      return snapshot;
    }).catch(error=>{if(isCurrent(current)&&revision===current.revision)void recoverDevice(error);});
    if(!capture.full)current.metaPromise=promise;
    return promise;
  }
  function recoverDevice(error) {
    if(disposed)return Promise.resolve();
    if(recoveryPromise)return recoveryPromise;
    recovering=true;
    recoveryPromise=performRecovery(error).finally(()=>{recovering=false;recoveryPromise=null;});
    return recoveryPromise;
  }
  async function performRecovery(error) {
    gpuUnavailable=message(error);paused=true;manualTarget=null;controlSerial++;synchronizing=false;resetClock();
    const current=scene, saved=renderer?.saveCamera();
    const lastConfirmedTime=current?.meta.time ?? 0;
    if(current)current.revision++;
    const failedDevice=device;device=null;timing?.dispose();timing=null;
    emit({paused:true,loading:true,actualSpeed:0,forceBackendDetail:`WebGPU 已中断：${gpuUnavailable}`});
    try {
      renderer?.dispose();renderer=null;
      const {createWebGLRenderer}=await import('../render/webgl.js');
      if(disposed)return;
      renderer=createWebGLRenderer(host,callbacks,saved);renderer.setTrails(trails);renderer.setQuality(quality);
      if(current && isCurrent(current)){
        const old=current.engine;current.engine=null;
        if(old)void old.dispose();
        if(current.checkpoint && old){
          const restored=await current.cpu.request(current.epoch,'restore',{snapshot:current.checkpoint,config:current.config});
          if(!isCurrent(current))return;
          current.meta=restored.snapshot;current.checkpoint=restored.snapshot;
          current.positions=new Float32Array(restored.snapshot.positions);
        }
        renderer.setSnapshot(current.positions || new Float32Array(current.checkpoint.positions),current.meta);
        targetStep=current.meta.acceptedSteps;freeEncodedStep=targetStep;
        const recoveryMessage=`已恢复至 ${current.meta.time.toFixed(2)} s 检查点，最后确认进度为 ${lastConfirmedTime.toFixed(2)} s；未确认的 GPU 进度也可能丢失。点击播放继续 CPU 模拟。`;
        emit({ready:true,forceBackend:'direct',time:current.meta.time,collisions:current.meta.collisions,
          computeLabel:'CPU 物理计算 / 批次',computeMs:null,renderMs:null,
          status:current.meta.status,detail:recoveryMessage,diagnostics:null});
        onError(recoveryMessage);
      }
    } catch(reason){onError(`恢复失败：${message(reason)}`);emit({ready:false});}
    finally{emit({loading:preparingEpoch!==null,paused:true});failedDevice?.destroy();}
  }

  try {
    if(!navigator.gpu)throw new Error('浏览器不支持 WebGPU');
    const adapter=await bounded(navigator.gpu.requestAdapter({powerPreference:'high-performance'}),15000,'GPU 适配器初始化');
    if(disposed)throw aborted();
    if(!adapter)throw new Error('未找到 WebGPU 设备');
    let abandoned=false;
    const creating=adapter.requestDevice({requiredFeatures:adapter.features.has('timestamp-query')?['timestamp-query']:[]})
      .then(value=>{if(disposed||abandoned){value.destroy();throw aborted();}return value;});
    try { device=await bounded(creating,15000,'GPU 设备初始化'); }
    catch(error){abandoned=true;throw error;}
    renderer=await createGpuRenderer(host,device,callbacks);
    if(disposed){renderer.dispose();throw aborted();}
    timing=createGpuTiming(device);
    const watched=device;
    void watched.lost.then(info=>{if(device===watched&&!disposed)void recoverDevice(new Error(info.message || 'GPU 设备丢失'));});
    watched.addEventListener('uncapturederror',event=>{if(device===watched&&!disposed)void recoverDevice(event.error);});
  } catch(error) {
    gpuUnavailable=message(error);device?.destroy();device=null;
    if(disposed)throw error;
    const {createWebGLRenderer}=await import('../render/webgl.js');
    if(disposed)throw aborted();
    renderer=createWebGLRenderer(host,callbacks);
  }

  async function apply(config) {
    const epoch=++generation, cpu=cpuClient();
    let engine=null;
    candidates.set(epoch,cpu);
    preparingEpoch=epoch;
    emit({loading:true});
    try {
      const prepared=await cpu.request(epoch,'initialize',{config});
      await recoveryPromise;
      if(disposed||generation!==epoch){cpu.dispose();return;}
      let initial=prepared.snapshot, backendDetail='';
      if(config.forceBackend!=='direct' && device && !recovering){
        try {
          let expired=false;
          const preparing=createGpuEngine(device,initial,config).then(value=>{if(expired)void value.dispose();return value;});
          try { engine=await bounded(preparing,30000,'GPU 引擎初始化'); }
          catch(error){expired=true;throw error;}
          initial={...initial,...engine.initialState};
        }
        catch(error){backendDetail=`WebGPU 初始化失败，使用 CPU：${message(error)}`;}
      } else if(config.forceBackend!=='direct')backendDetail=`使用 CPU：${gpuUnavailable || 'WebGPU 暂不可用'}`;
      await recoveryPromise;
      if(disposed||generation!==epoch){cpu.dispose();engine?.dispose();return;}
      // A device may have failed while asynchronous pipelines were compiling.
      if(!device && engine){engine.dispose();engine=null;initial=prepared.snapshot;backendDetail='WebGPU 已不可用，使用 CPU。';}
      const next={epoch,revision:0,cpu,engine,config:{...config,...prepared.config},meta:initial,
        initial:snapshotForReference(initial,config),checkpoint:snapshotForReference(initial,config),
        lastFull:0,lastLight:0,lastDiagnostic:0,slots:config.count>=10000?1:8,cpuBusy:false,
        positions:engine?null:new Float32Array(initial.positions)};
      const previous=scene;
      renderer.resetTrails();
      if(engine)renderer.setSource(engine.source);else renderer.setSnapshot(next.positions,initial);
      renderer.setBounds(initial.bounds,initial.radius);renderer.setTrails(trails);renderer.setQuality(quality);
      scene=next;
      targetStep=initial.acceptedSteps;freeEncodedStep=targetStep;manualTarget=null;controlSerial++;synchronizing=false;resetClock();
      retire(previous);
      void ensureBaseline(next).catch(error=>{if(isCurrent(next))emit({detail:`初始参考：${message(error)}`});});
      emit({ready:true,loading:false,time:initial.time,collisions:initial.collisions,count:initial.count,
        paused,status:'running',detail:'',actualSpeed:0,computeMs:null,renderMs:null,diagnostics:null,
        forceBackend:engine?'webgpu':'direct',forceBackendDetail:backendDetail,
        computeLabel:engine?(timing?'GPU 物理计算 / 批次':'GPU 提交至完成'):'CPU 物理计算 / 批次'});
      onError('');
    } catch(error) {
      cpu.dispose();engine?.dispose();
      if(generation===epoch){
        if(scene&&renderer){
          if(scene.engine&&renderer.kind==='webgpu')renderer.setSource(scene.engine.source);
          else if(scene.positions)renderer.setSnapshot(scene.positions,scene.meta);
        }
        emit({loading:false});throw error;
      }
    } finally {candidates.delete(epoch);if(preparingEpoch===epoch)preparingEpoch=null;}
  }

  function reserve(now) {
    const elapsed=Math.min(.1,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
    if(!scene || synchronizing || recovering || !graphicsReady || document.hidden || scene.meta.status==='stopped')return;
    if(paused)return;
    debt=Math.min(debt+elapsed*speed,Math.max(DT,speed*.1));
    const available=Math.floor((debt+1e-12)/DT);
    const maxLead=Math.max(64,Math.ceil(speed*30));
    const grant=Math.max(0,Math.min(available,maxLead-(targetStep-scene.meta.acceptedSteps)));
    targetStep+=grant;debt-=grant*DT;
  }
  function wantsPhysics(current) {
    return isCurrent(current) && !synchronizing && !recovering && graphicsReady && !document.hidden
      && current.meta.status!=='stopped' && (!paused || manualTarget!==null);
  }
  function advanceCpu(current,now) {
    if(current.cpuBusy || !wantsPhysics(current) || targetStep<=current.meta.acceptedSteps)return;
    current.cpuBusy=true;
    const started=now;
    current.cpuPromise=current.cpu.request(current.epoch,'advance',{steps:targetStep-current.meta.acceptedSteps,budgetMs:8})
      .then(result=>{
        if(!isCurrent(current))return;
        current.positions=result.positions;
        const meta={...current.meta,...result.meta,bounds:result.bounds};
        if(!recovering)renderer?.setSnapshot(result.positions,meta);acceptMetadata(current,meta);
        emit({computeMs:result.meta.stepMs ?? performance.now()-started,computeLabel:'CPU 物理计算 / 批次'});
      }).catch(error=>{if(isCurrent(current)){paused=true;manualTarget=null;emit({paused:true,status:'stopped'});onError(message(error));}})
      .finally(()=>{current.cpuBusy=false;});
  }
  function frame(now) {
    if(disposed)return;
    frameId=requestAnimationFrame(frame);
    reserve(now);
    if(!renderer || recovering || document.hidden || !graphicsReady)return;
    renderer.update(now);
    const current=scene;
    if(!current)return;
    if(!current.engine)advanceCpu(current,now);
    if(renderer.kind==='webgpu' && device && inFlight<2){
      try {
        const encoder=device.createCommandEncoder({label:'Gravity frame'});
        let slots=0,stamp=null;
        if(current.engine && wantsPhysics(current) && targetStep>current.meta.acceptedSteps){
          slots=current.config.collisionless ? Math.min(current.slots,targetStep-freeEncodedStep) : current.slots;
          if(slots>0){
            if(now-lastTiming>=500){stamp=timing?.begin();if(stamp)lastTiming=now;}
            current.engine.encodeAdvance(encoder,{targetStep,slots,timestampWrites:stamp?.physics});
            if(current.config.collisionless)freeEncodedStep+=slots;
          }
        }
        let capture=null;
        if(current.engine){
          const full=now-current.lastFull>=1000;
          if(full || now-current.lastLight>=100 || manualTarget!==null){
            capture=current.engine.encodeCapture(encoder,{full});
            if(capture){current.lastLight=now;if(full)current.lastFull=now;}
          }
        }
        renderer.encode(encoder,now,stamp?.render);
        stamp?.resolve(encoder);
        const submittedDevice=device;
        const submittedRevision=current.revision;
        submittedDevice.queue.submit([encoder.finish()]);inFlight++;
        const started=performance.now();
        void bounded(submittedDevice.queue.onSubmittedWorkDone(),15000,'GPU 队列').then(()=>{
          if(!isCurrent(current)||submittedRevision!==current.revision||device!==submittedDevice||!slots)return;
          const ms=performance.now()-started;
          // Submission-to-completion includes queue/render time. It is not a
          // fabricated GPU timestamp. Keep the next batch small and bounded.
          if(ms>12)current.slots=Math.max(1,Math.floor(current.slots*.65));
          else if(ms<5)current.slots=Math.min(64,current.slots+1);
          if(!timing)emit({computeMs:ms,computeLabel:'GPU 提交至完成'});
        }).catch(error=>{if(device===submittedDevice)void recoverDevice(error);}).finally(()=>{inFlight--;});
        if(capture)void receiveCapture(current,capture);
        if(stamp)void stamp.read().then(result=>{
          if(isCurrent(current)&&submittedRevision===current.revision&&device===submittedDevice)
            emit({computeMs:result.physicsMs,renderMs:result.renderMs,computeLabel:'GPU 物理计算 / 批次'});
        }).catch(()=>{ /* Optional timing failures do not invalidate a physical step. */ });
      } catch(error){void recoverDevice(error);}
    } else if(renderer.kind==='webgl')renderer.render(now);
    if(!current.engine && diagnosticsVisible && !current.referenceBusy && !current.snapshotBusy && now-current.lastDiagnostic>=1000){
      current.lastDiagnostic=now;current.snapshotBusy=true;
      void current.cpu.request(current.epoch,'snapshot').then(result=>diagnose(current,result.snapshot))
        .catch(error=>{if(isCurrent(current))emit({detail:message(error)});}).finally(()=>{current.snapshotBusy=false;});
    }
  }
  async function synchronizePause(serial) {
    const current=scene;
    if(!current)return;
    synchronizing=true;
    try {
      if(current.engine && device){
        await bounded(device.queue.onSubmittedWorkDone(),15000,'GPU 暂停');
        await current.metaPromise;
        if(!isCurrent(current)||serial!==controlSerial||!device)return;
        const encoder=device.createCommandEncoder();
        const capture=current.engine.encodeCapture(encoder,{full:false});
        if(capture){device.queue.submit([encoder.finish()]);await receiveCapture(current,capture);}
      } else await current.cpuPromise;
      if(isCurrent(current)&&serial===controlSerial){targetStep=current.meta.acceptedSteps;freeEncodedStep=targetStep;resetClock();}
    } catch(error){if(isCurrent(current))void recoverDevice(error);}
    finally{if(serial===controlSerial)synchronizing=false;}
  }
  function discardUnsubmitted() {
    if(!scene||recovering)return;
    manualTarget=null;
    void synchronizePause(++controlSerial);
  }
  function visibility(){resetClock();discardUnsubmitted();}
  document.addEventListener('visibilitychange',visibility);
  frameId=requestAnimationFrame(frame);
  return {
    apply,
    restart:()=>scene?apply(scene.config):Promise.resolve(),
    setSpeed(value){const next=Math.max(.1,Math.min(20,value));if(next!==speed){speed=next;resetClock();discardUnsubmitted();}},
    setPaused(value){
      if(!scene || scene.meta.status==='stopped')return;
      paused=Boolean(value);manualTarget=null;resetClock();emit({paused,actualSpeed:0});onError('');
      const serial=++controlSerial;
      void synchronizePause(serial);
    },
    step(){
      if(!scene || scene.meta.status==='stopped' || manualTarget!==null || synchronizing)return;
      paused=true;emit({paused:true,actualSpeed:0});
      const serial=++controlSerial;
      void synchronizePause(serial).then(()=>{
        if(!disposed && scene && serial===controlSerial && !recovering){manualTarget=scene.meta.acceptedSteps+1;targetStep=manualTarget;}
      });
    },
    setTrails(value){trails=Boolean(value);renderer?.setTrails(trails);},
    setQuality(value){quality=value;renderer?.setQuality(value);},
    setDiagnostics(value){diagnosticsVisible=Boolean(value);if(scene&&value){scene.lastFull=0;scene.lastDiagnostic=0;}},
    async focus(){
      const current=scene;
      if(current?.engine&&device&&!recovering){
        try {
          // Ask for fresh bounds without stopping the clock or advancing a step.
          await current.metaPromise;
          if(!isCurrent(current)||!current.engine||!device||recovering)return;
          const encoder=device.createCommandEncoder(),capture=current.engine.encodeCapture(encoder,{full:false});
          if(capture){device.queue.submit([encoder.finish()]);await receiveCapture(current,capture);}
          if(isCurrent(current))renderer?.fit();
        } catch(error){if(isCurrent(current))void recoverDevice(error);}
      } else renderer?.fit();
    },
    dispose,
  };
}

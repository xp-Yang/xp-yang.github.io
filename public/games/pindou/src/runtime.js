// Small scheduling primitives, with injectable clocks for deterministic tests.
export function createSaveQueue(write,{now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let timer=null,first=null,last=-Infinity;
  const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  const flush=()=>{clear();first=null;last=now();write();};
  return {flush,get pending(){return timer!==null;},defer(){
    const t=now();if(first===null)first=t;clear();
    timer=setTimer(flush,Math.max(0,Math.min(150,Math.max(first+1000,last+1000)-t)));
  },cancel(){clear();first=null;}};
}
export function createScheduler(run,{raf=requestAnimationFrame,cancelRaf=cancelAnimationFrame,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let frame=null,timer=null;
  const stop=()=>{if(frame!==null)cancelRaf(frame);if(timer!==null)clearTimer(timer);frame=null;timer=null;};
  const request=()=>{if(timer!==null)clearTimer(timer);timer=null;if(frame===null)frame=raf(t=>{frame=null;run(t);});};
  return {request,stop,wakeAfter(ms){if(frame!==null)return;if(timer!==null)clearTimer(timer);timer=setTimer(()=>{timer=null;request();},ms);}};
}
export function createActiveClock(now=()=>performance.now()){
  let last=now(),active=false;
  return {sample(enabled=active){const t=now(),seconds=active?Math.max(0,(t-last)/1000):0;last=t;active=enabled;return seconds;},reset(enabled=false){last=now();active=enabled;}};
}
export function createLatestLoad(){let version=0;return {begin:()=>++version,cancel:()=>{version++;},isCurrent:id=>id===version};}

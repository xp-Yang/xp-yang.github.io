// Resume Web Audio from a real gesture so delayed placement/win effects work on iOS.
export function createSoundPlayer(enabled){
  const volumes={pick:.4,place:.35,win:.4},fallback=Object.fromEntries(Object.keys(volumes).map(name=>{const a=new Audio(`assets/${name}.wav`);a.volume=volumes[name];a.preload='auto';return [name,a];}));
  let context=null;const buffers=new Map(),pending=new Map();
  function prepare(){
    for(const name of Object.keys(volumes))if(!buffers.has(name)&&!pending.has(name)){
      const request=fetch(`assets/${name}.wav`).then(r=>{if(!r.ok)throw Error('audio unavailable');return r.arrayBuffer();}).then(data=>context.decodeAudioData(data)).then(buffer=>buffers.set(name,buffer)).catch(()=>{}).finally(()=>pending.delete(name));pending.set(name,request);
    }
  }
  function unlock(){
    if(!enabled())return;
    if(window.pindouNative)return;
    const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)return;
    try{if(!context)context=new AudioContext();if(context.state!=='running')context.resume().catch(()=>{});prepare();}catch{}
  }
  function play(name){
    if(!enabled())return;
    if(window.pindouNative){window.pindouNative.playSound(name);return;}
    if(context?.state==='running'&&buffers.has(name)){
      const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffers.get(name);gain.gain.value=volumes[name];source.connect(gain);gain.connect(context.destination);source.onended=()=>{source.disconnect();gain.disconnect();};source.start();
    }else{const a=fallback[name];a.currentTime=0;a.play().catch(()=>{});}
  }
  function pause(){window.pindouNative?.pauseSound();if(context?.state==='running')context.suspend().catch(()=>{});for(const a of Object.values(fallback))a.pause();}
  return {unlock,play,pause};
}

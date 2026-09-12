import {levels} from './levels.js';
import {SAVE_KEY,createSession,interact,expandTray,elapse,claimReward,readProfile,isLevelUnlocked} from './engine.js';
import {createRenderer,point,hitTest} from './render.js';
import {assetLoader} from './assets.js';
import {createSaveQueue,createScheduler,createActiveClock,createLatestLoad} from './runtime.js';
import {layout,zoomBoard,resetBoard,bindBoardGestures} from './viewport.js';
import {canvasResolution} from './quality.js';
import {fitMobileViewport} from './mobile.js';
import {createSoundPlayer} from './sound.js';

const canvas=document.querySelector('#board'),ctx=canvas.getContext('2d'),overlay=document.querySelector('#overlay'),controls=document.querySelector('#controls'),game=document.querySelector('#game');
let storage;try{storage=window.pindouStorage||localStorage;}catch{storage={getItem:()=>null,setItem:()=>{throw Error('unavailable');}};}
const profile=readProfile(storage,levels);
let state=profile.session,level=levels.find(l=>l.id===state?.levelId)||levels[0],assets=assetLoader.loaded,screen='home',modal=null,busy=false,flights=[],sparkles=[],lastSave=0,toastTimer,saveWarning=false,wonAt=0,homeContent='',entryShown=false,queuedTap=null,lastSerialized=null,retryLoad=null;
const renderer=createRenderer(ctx),activeClock=createActiveClock(),loadVersion=createLatestLoad();
const scheduler=createScheduler(tick),saver=createSaveQueue(writeSave);
function playing(){return screen==='play'&&!modal&&!document.hidden&&!window.pindouNativePaused&&state?.status==='playing';}
function syncTime(){const seconds=activeClock.sample(playing());if(seconds&&state?.status==='playing'){elapse(state,seconds);if(state.status==='lost'){queuedTap=null;flights=[];sparkles=[];busy=false;showLoss();}}}
function wake(){activeClock.reset(playing());if(screen==='play'&&!modal&&!document.hidden)scheduler.request();else scheduler.stop();}
const audio=createSoundPlayer(()=>profile.sound);
for(const event of ['pointerdown','touchend','keydown'])window.addEventListener(event,audio.unlock,{capture:true,passive:true});
function sound(name){audio.play(name);}
function toast(message){if(!message)return;const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2400);}
function writeSave(){syncTime();profile.session=state;lastSave=performance.now();try{const serialized=JSON.stringify(profile);if(serialized!==lastSerialized){storage.setItem(SAVE_KEY,serialized);lastSerialized=serialized;}}catch{if(!saveWarning){saveWarning=true;toast('浏览器无法保存进度，本次仍可正常游玩');}}}
function save(){saver.flush();}
function resize(){syncTime();const viewport=document.querySelector('#viewport'),visual=window.visualViewport,width=visual?.width||window.innerWidth,height=visual?.height||window.innerHeight;viewport.style.height=`${height}px`;const css=window.getComputedStyle(viewport),insets={left:parseFloat(css.paddingLeft),right:parseFloat(css.paddingRight),top:parseFloat(css.paddingTop),bottom:parseFloat(css.paddingBottom)};const {scale}=fitMobileViewport(width,height,insets);game.style.setProperty('--scale',scale);const resolution=canvasResolution(scale,window.devicePixelRatio||1);if(canvas.width!==resolution.width||canvas.height!==resolution.height){canvas.width=resolution.width;canvas.height=resolution.height;renderer.dispose();}ctx.setTransform(canvas.width/720,0,0,canvas.height/1280,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';wake();}
window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);resize();
function imageButton(action,name,cls,label){if(action==='next')return '<button type="button" class="blue next choose-levels" data-action="next">选择关卡</button>';return `<button type="button" class="image-button ${cls}" data-action="${action}" aria-label="${label}"><img src="assets/${name}.png" alt="${label}" draggable="false"></button>`;}
function balances(){return `<div class="balances"><div class="energy-value" aria-label="体力 ${profile.energy}"><span>${profile.energy}/100</span></div><div class="coin-value"><img src="assets/coin.png" alt="金币">${profile.coins}</div></div>`;}
function panel(title,content,cls=''){return `<div class="veil"><section class="panel ${cls}" role="dialog" aria-modal="true" aria-label="${title}"><h1 class="panel-title">${title}</h1><button class="close" data-action="close" aria-label="关闭"></button>${content}</section></div>`;}
function setModal(name,html){syncTime();queuedTap=null;if(name!=='loading')loadVersion.cancel();modal=name;overlay.innerHTML=(screen==='home'?homeContent.replace('<div class="home">','<div class="home" inert>'):'')+html;wake();requestAnimationFrame(()=>overlay.querySelector('[role="dialog"] button')?.focus({preventScroll:true}));}
function clearModal(){syncTime();loadVersion.cancel();modal=null;overlay.innerHTML='';if(screen==='home')showHome();wake();}
function withAssets(group,commit){
  const token=loadVersion.begin();queuedTap=null;retryLoad=()=>withAssets(group,commit);
  if(assetLoader.ready(group)){commit();return;}
  const timer=setTimeout(()=>{if(loadVersion.isCurrent(token)){assetLoader.load('loading').catch(()=>{});setModal('loading','<div class="loading"><img src="assets/load.png" alt="拼豆狂欢"><div class="loading-line"></div><button class="secondary cancel-loading" data-action="cancel-loading">返回选关</button></div>');}},120);
  assetLoader.load(group).then(()=>{clearTimeout(timer);if(loadVersion.isCurrent(token))commit();}).catch(error=>{
    clearTimeout(timer);if(!loadVersion.isCurrent(token))return;
    setModal('load-error',panel('素材加载失败','<p>请检查本地服务后重试。</p><button class="blue" data-action="retry-load">重新加载</button><button class="secondary" data-action="cancel-loading">返回选关</button>'));console.error(error);
  });
}
function baseControls(){controls.innerHTML=`<button class="hotspot" style="left:10px;top:50px;width:64px;height:65px" data-action="settings" aria-label="设置"></button><div class="board-view-controls" role="group" aria-label="图案视图"><button data-action="zoom-out" aria-label="缩小图案" title="缩小图案">−</button><button data-action="view-reset" title="恢复图案大小与位置">复位</button><button data-action="zoom-in" aria-label="放大图案" title="放大图案">＋</button></div><button class="hotspot" style="left:295px;top:1037px;width:130px;height:79px" data-action="expand" aria-label="加仓，增加十二格暂存空间"></button>${[3,4,5].map((n,i)=>`<button class="hotspot" style="left:${67+i*210}px;top:1110px;width:170px;height:137px" data-action="locked-${n}" aria-label="道具，第${n}关解锁"></button>`).join('')}`;}
function startLevel(id,resume=false){
  const selectedLevel=levels.find(l=>l.id===id);if(!selectedLevel||!isLevelUnlocked(profile,id))return;
  withAssets('game',()=>{
    syncTime();level=selectedLevel;
    if(!resume){state=createSession(level);state.tutorialStep=id===1&&!profile.tutorialDone?0:6;}
    profile.currentLevel=id;flights=[];sparkles=[];queuedTap=null;busy=false;screen='play';renderer.dispose();save();baseControls();clearModal();
    assetLoader.load('settlement').catch(()=>{});
  });
}
function showSettings(){setModal('settings',panel('设置',`<div class="settings-list"><label>游戏音效<input data-setting="sound" type="checkbox" ${profile.sound?'checked':''}></label></div><button class="blue" data-action="close">${screen==='home'?'返回选关':'继续游戏'}</button>${screen==='play'?'<button class="yellow" data-action="home">返回选关主页</button><button class="secondary" data-action="restart">重新开始本关</button>':''}`));}
function showLevels(){showHome();}
function canResume(id){return state?.levelId===id&&state.status==='playing'&&state.remaining<level.timeLimit;}
function showPreview(id){
  const l=levels.find(l=>l.id===id);if(!l||!isLevelUnlocked(profile,id))return;
  const resume=canResume(id);
  setModal('preview',panel(`第 ${id} 关`,`<div class="picture"><img src="assets/pattern-${id}.png" alt="${l.name}"></div>${resume?`<button class="blue resume-game" data-action="resume-${id}">继续本关</button><button class="secondary" data-action="start-${id}">重新开始</button>`:`<img class="free" src="assets/free.png" alt="免费">${imageButton('start-'+id,'start-button','start','开始游戏')}`}`,'preview'));
}
function showHome(){
  syncTime();loadVersion.cancel();queuedTap=null;
  if(state?.status==='won')award(1);
  screen='home';modal=null;busy=false;flights=[];sparkles=[];wonAt=0;controls.innerHTML='';save();
  homeContent=`<div class="home">
    ${balances()}<button class="home-settings" data-action="settings" aria-label="设置"></button>
    <header class="home-heading"><h1>选择关卡</h1><p>选一幅图案，开始拼豆</p></header>
    <div class="home-scroll"><div class="home-levels" aria-label="关卡列表">
      ${levels.map((l,i)=>{
        const locked=!isLevelUnlocked(profile,l.id),resume=canResume(l.id);
        return `<button class="level-card${locked?' is-locked':''}" data-action="preview-${l.id}" ${locked?'disabled':''} aria-label="第 ${l.id} 关，${locked?'未解锁':`${l.name}，${resume?'继续游戏':'可游玩'}`}">
          <span class="level-thumbnail">${locked?'<span class="level-mystery" aria-hidden="true">?</span>':`<img src="assets/pattern-${l.id}.png" alt="${l.name}" draggable="false">`}</span>
          <span class="level-number">第 ${l.id} 关</span><span class="level-name">${locked?'':l.name}</span>
          <span class="level-status">${locked?(i>0?`通过第 ${levels[i-1].id} 关解锁`:'未解锁'):resume?'继续游戏':'开始拼豆'}</span>
        </button>`;
      }).join('')}
    </div></div>
  </div>`;
  overlay.innerHTML=homeContent;
  renderer.dispose();wake();
}
function confetti(){const colors=['#fff3b2','#e1faff','#ffbef0','#a5ffd1','#cec4ff'];return `<div class="confetti">${Array.from({length:65},(_,i)=>`<i style="--x:${(i*173)%720}px;--w:${10+i%15}px;--h:${8+i%20}px;--color:${colors[i%5]};--duration:${3+i%4}s;--delay:-${(i*.173)%5}s;--drift:${(i%2?1:-1)*(30+i%70)}px"></i>`).join('')}</div>`;}
function showWin(){withAssets('settlement',renderWin);}
function renderWin(){
  sound('win');const claimed=profile.claimed.includes(state.runId),current=profile.streak+(claimed?0:1),best=Math.max(profile.bestStreak,current);
  setModal('win',`<div class="veil"></div>${balances()}<section class="win" role="dialog" aria-modal="true" aria-label="恭喜过关"><img class="heading" src="assets/win-title.png" alt="恭喜过关"><button class="close" data-action="finish-home" aria-label="领取奖励并返回主页"></button><div class="art"><img src="assets/pattern-${level.id}.png" alt="完成的图案"></div><div class="streak"><span>当前连胜：${current}</span><span>最高连胜：${best}</span></div><div class="reward-label">奖励</div><img class="rewards" src="assets/rewards.png" alt="金币十、体力五、拼图一">${imageButton('double','double-button','double','双倍领取')}${imageButton('next','next-button','next','下一关')}${confetti()}</section>`);
  if(claimed){const b=overlay.querySelector('[data-action="double"]');b.disabled=true;b.setAttribute('aria-label','奖励已领取');}
  const pig=document.createElement('img');pig.src='assets/pig.png';pig.className='pig';pig.alt='存钱罐进度';overlay.querySelector('.win').append(pig);
  if(level.id===1&&!profile.tutorialDone&&!entryShown){entryShown=true;showEntry();}
}
function showEntry(){
  queuedTap=null;
  modal='entry';const wrapper=document.createElement('div');wrapper.className='entry-wrap';wrapper.innerHTML='<div class="entry-dim"></div><section class="entry-dialog" role="dialog" aria-label="入口有奖" aria-modal="true"><img src="assets/entry-dialog.png" alt="入口有奖：从抖音侧边栏进入游戏可获得奖励"><button class="hotspot" style="left:295px;top:9px;width:47px;height:55px" data-action="entry-close" aria-label="关闭入口有奖"></button><button class="hotspot" style="left:79px;top:400px;width:175px;height:79px" data-action="entry-local" aria-label="进入侧边栏"></button></section>';overlay.append(wrapper);
}
function showLoss(){profile.streak=0;save();setModal('lost',panel('时间到',`<p>再试一次，把拼豆送回家！</p><button class="blue" data-action="restart">重新挑战</button><button class="secondary" data-action="home">返回主页</button>`));}
function award(multiplier){const next=levels[levels.findIndex(l=>l.id===state.levelId)+1];const ok=claimReward(profile,state,multiplier,next?.id);save();return ok;}
function act(action){
  if(action==='retry-load'){retryLoad?.();return;}
  if(action==='cancel-loading'){showHome();return;}
  if(busy&&!modal&&action!=='settings')return;
  if(['zoom-in','zoom-out','view-reset'].includes(action)){
    if(modal||screen!=='play'||state.status!=='playing')return;
    if(action==='view-reset')resetBoard(state);else zoomBoard(level,state,action==='zoom-in'?1.2:1/1.2,{x:360,y:(210+layout(level,state).trayTop)/2});
    save();return;
  }
  if(action==='entry'){showEntry();return;}
  if(action==='entry-local'){toast('本地版本无需进入抖音侧边栏');return;}
  if(action==='entry-close'||(action==='close'&&modal==='entry')){overlay.querySelector('.entry-wrap')?.remove();modal=screen==='play'&&state.status==='won'?'win':null;return;}
  if(action==='close'){if(state.status==='won'&&screen==='play'){showWin();return;}clearModal();return;}
  if(action==='settings'){showSettings();return;}
  if(action==='expand'){if(state.status!=='playing')return;if(expandTray(state)){sound('place');save();toast('已增加 12 格暂存空间');}else toast('暂存区已扩展至上限');return;}
  if(action.startsWith('locked-')){toast(`第 ${action.split('-')[1]} 关解锁`);return;}
  if(action==='unavailable'){toast('该页面尚未补充原版参考');return;}
  if(action==='home'){showHome();return;}
  if(action==='levels'){showLevels();return;}
  if(action==='restart'){startLevel(level.id);return;}
  if(action.startsWith('resume-')){
    const id=Number(action.split('-')[1]);if(!isLevelUnlocked(profile,id)||!canResume(id))return;
    startLevel(id,true);return;
  }
  if(action.startsWith('preview-')){showPreview(Number(action.split('-')[1]));return;}
  if(action.startsWith('start-')){startLevel(Number(action.split('-')[1]));return;}
  if(action==='double'){
    if(award(2)){toast('已领取双倍奖励');const b=overlay.querySelector('[data-action="double"]');b.disabled=true;b.setAttribute('aria-label','奖励已领取');overlay.querySelector('.balances').outerHTML=balances();}return;
  }
  if(action==='next'){award(1);showHome();return;}
  if(action==='finish-home'){award(1);showHome();return;}
}
document.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(b&&!b.disabled){syncTime();act(b.dataset.action);wake();}});
overlay.addEventListener('change',e=>{if(e.target.dataset.setting){profile[e.target.dataset.setting]=e.target.checked;save();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();if(modal&&modal!=='loading')act('close');else if(screen==='play')showSettings();}if(e.key==='Tab'&&modal){const buttons=[...overlay.querySelectorAll('button:not(:disabled),input')];if(!buttons.length)return;const first=buttons[0],end=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();end.focus();}else if(!e.shiftKey&&document.activeElement===end){e.preventDefault();first.focus();}}});
function handleTap(hit){
  syncTime();if(!playing())return;
  if(busy){queuedTap=hit?{...hit,runId:state.runId}:null;return;}
  // Moving does not change layout: only source coordinates are needed for animation.
  const result=interact(level,state,hit);
  if(result.kind==='selected'){
    sound('pick');
    if(level.id===1&&!profile.tutorialDone){
      if(state.tutorialStep===0&&state.selection.color==='G')state.tutorialStep=1;
      else if(state.tutorialStep===2&&state.selection.color==='R')state.tutorialStep=3;
      else if(state.tutorialStep===4&&hit.zone==='tray')state.tutorialStep=5;
    }
  }else if(result.kind==='moved'){
    busy=true;const now=performance.now();
    const l=layout(level,state);
    flights=result.moves.map((m,i)=>({...m,fromPoint:point(level,state,m.fromZone,m.from,l),start:now+i*Math.min(24,240/result.moves.length),duration:330}));
    sparkles=result.moves.filter(m=>m.toZone==='board').map((m,i)=>({index:m.to,start:now+330+i*Math.min(24,240/result.moves.length)}));
    if(level.id===1&&!profile.tutorialDone){if(hit.zone==='tray')state.tutorialStep=2;else if(result.moves[0].color==='R')state.tutorialStep=4;else state.tutorialStep=6;}
    sound('place');wonAt=state.status==='won'?flights.at(-1).start+850:0;
    if(state.status==='won')queuedTap=null;
  }
  renderer.invalidate();save();scheduler.request();
}
bindBoardGestures(canvas,{
  getContext:()=>({level,state,enabled:!modal&&screen==='play'&&state?.status==='playing',allowTransform:!busy}),
  onChange:()=>{saver.defer();scheduler.request();},onEnd:save,
  onTap:p=>handleTap(hitTest(level,state,p.x,p.y))
});
window.addEventListener('pagehide',()=>{save();scheduler.stop();activeClock.reset(false);});
window.addEventListener('pageshow',wake);
window.addEventListener('blur',save);
document.addEventListener('visibilitychange',()=>{syncTime();if(document.hidden){queuedTap=null;save();scheduler.stop();audio.pause();}wake();});
function tick(now){
  syncTime();if(screen!=='play'||modal||document.hidden)return;
  if(flights.length&&flights.every(f=>now>=f.start+f.duration)){
    flights=[];busy=false;renderer.invalidate();
    const queued=queuedTap;queuedTap=null;if(queued?.runId===state.runId&&state.status==='playing')handleTap(queued);
  }
  sparkles=sparkles.filter(s=>now<s.start+650);
  const tutorial=!profile.tutorialDone&&level.id===1&&state.tutorialStep<6;
  renderer.draw(assets,level,state,{flights,sparkles,streak:profile.streak,tutorial},now);
  if(wonAt&&now>=wonAt&&!modal){wonAt=0;showWin();}
  if(playing()&&!saver.pending&&now-lastSave>=3000)save();
  if(modal||document.hidden||screen!=='play')return;
  if(flights.length||sparkles.length||(tutorial&&state.status==='playing'))scheduler.request();
  else if(wonAt)scheduler.wakeAfter(Math.max(1,wonAt-now));
  else if(playing())scheduler.wakeAfter(Math.max(1,(state.remaining-(Math.ceil(state.remaining)-1))*1000));
}
if(!state){state=createSession(level);state.tutorialStep=profile.tutorialDone?6:0;}
showHome();
assetLoader.load('home').catch(()=>{if(screen==='home'&&!modal){retryLoad=()=>withAssets('home',showHome);setModal('load-error',panel('素材加载失败','<p>部分缩略图暂未加载。</p><button class="blue" data-action="retry-load">重试</button>'));}});

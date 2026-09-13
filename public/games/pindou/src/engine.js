export const SAVE_KEY = 'pindou-kuanghuan:v1';
export const MAX_TRAY_CAPACITY=96,TRAY_EXPANSION=12;
export function trayRules(level){
  const expansion=level.trayExpansion||TRAY_EXPANSION,configured=level.trayMaxExpansions!=null;
  const maxExpansions=configured?level.trayMaxExpansions:Math.ceil((MAX_TRAY_CAPACITY-level.capacity)/expansion);
  return {capacity:level.capacity,expansion,maxExpansions,maxCapacity:configured?level.capacity+expansion*maxExpansions:MAX_TRAY_CAPACITY};
}
export const defaultProfile = () => ({version:1,levelOrder:2,unlocked:1,unlockedLevels:[1],currentLevel:1,coins:100,energy:100,puzzles:0,streak:0,bestStreak:0,tutorialDone:false,sound:true,claimed:[],session:null});
export function isLevelUnlocked(profile,id){return Array.isArray(profile.unlockedLevels)?profile.unlockedLevels.includes(id):id<=profile.unlocked;}
export function createSession(level, runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  const rules=trayRules(level);
  return {levelId:level.id,runId,trayVersion:4,trayStep:rules.expansion,maxTrayCapacity:rules.maxCapacity,board:level.initial.flatMap(row=>[...row].map(c=>c==='.'?undefined:c)),tray:Array(rules.capacity).fill(null),remaining:level.timeLimit,status:'playing',selection:null,expanded:0,tutorialStep:0};
}
export function targetAt(level, index) {return level.target[Math.floor(index / level.target[0].length)]?.[index % level.target[0].length];}
export function locked(level, state, index) {return state.board[index] != null && state.board[index]===targetAt(level,index);}
export function adjacent(level,index,diagonal=false) {
  const w=level.target[0].length,r=Math.floor(index/w),c=index%w;
  const offsets=diagonal?[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]:[[-1,0],[0,-1],[0,1],[1,0]];
  return offsets.map(([dy,dx])=>[r+dy,c+dx]).filter(([y,x])=>y>=0&&y<level.target.length&&x>=0&&x<w&&level.target[y][x]!=='.').map(([y,x])=>y*w+x);
}
function flood(level,start,canVisit,diagonal=false) {
  const queue=[start],seen=new Set([start]),out=[];
  for(let n=0;n<queue.length;n++) {const i=queue[n];if(!canVisit(i))continue;out.push(i);for(const j of adjacent(level,i,diagonal))if(!seen.has(j)){seen.add(j);queue.push(j);}}
  return out;
}
export function select(level,state,zone,index) {
  if(state.status!=='playing')return false;
  const color=state[zone]?.[index];
  if(!color || (zone==='board'&&locked(level,state,index)))return false;
  const ids=zone==='tray'?state.tray.flatMap((c,i)=>c===color?[i]:[]):flood(level,index,i=>state.board[i]===color&&!locked(level,state,i),true);
  const width=level.target[0].length;
  const distance=i=>(i%width-index%width)**2+(Math.floor(i/width)-Math.floor(index/width))**2;
  if(zone==='board')ids.sort((a,b)=>distance(a)-distance(b)||a-b);
  state.selection={zone,color,anchor:index,ids};return true;
}
export function move(level,state,zone,index) {
  const selected=state.selection;
  const cancel=()=>{state.selection=null;return {moves:[],reason:''};};
  if(state.status!=='playing'||!selected)return {moves:[],reason:''};
  if(zone===selected.zone&&zone==='tray')return cancel();
  if(zone==='board' && (state.board[index]!=null||targetAt(level,index)!==selected.color))return cancel();
  let destinations=[];
  if(zone==='tray') destinations=state.tray.flatMap((c,i)=>c===null?[i]:[]);
  else destinations=flood(level,index,i=>targetAt(level,i)===selected.color,true).filter(i=>state.board[i]===null);
  const count=Math.min(destinations.length,selected.ids.length);
  if(!count)return cancel();
  const moves=[];
  for(let n=0;n<count;n++) {
    const from=selected.ids[n],to=destinations[n];
    state[selected.zone][from]=null;state[zone][to]=selected.color;
    moves.push({fromZone:selected.zone,from,toZone:zone,to,color:selected.color});
  }
  const remaining=selected.ids.slice(count);
  state.selection=remaining.length?{...selected,ids:remaining}:null;
  const relocations=compactTray(state,moves);
  if(isComplete(level,state))state.status='won';
  return {moves,relocations,reason:''};
}
// Keep color groups in first-appearance order and each group's beads stable.
// Read a snapshot before writing: gathering a later bead may shift others right.
function compactTray(state,moves=[]){
  const incoming=new Map(moves.filter(m=>m.toZone==='tray').map(m=>[m.to,m]));
  const groups=new Map();
  state.tray.forEach((color,from)=>{if(color!==null){if(!groups.has(color))groups.set(color,[]);groups.get(color).push(from);}});
  const positions=new Map(),relocations=[];let next=0;
  for(const [color,indices] of groups)for(const from of indices){
    const to=next++;positions.set(from,to);
    if(incoming.has(from))incoming.get(from).to=to;
    else if(from!==to)relocations.push({fromZone:'tray',from,toZone:'tray',to,color});
    state.tray[to]=color;
  }
  state.tray.fill(null,next);
  if(state.selection?.zone==='tray'){
    state.selection.ids=state.selection.ids.map(i=>positions.get(i));
    state.selection.anchor=positions.get(state.selection.anchor)??state.selection.ids[0];
  }
  return relocations;
}
// UI clicks and touch taps share the same selection/cancellation rules.
export function interact(level,state,hit){
  if(state.status!=='playing')return {kind:'none',moves:[]};
  const cancel=()=>{state.selection=null;return {kind:'cancelled',moves:[]};};
  if(!hit)return cancel();
  const {zone,index}=hit,color=state[zone]?.[index];
  if(color){
    if((zone==='board'&&locked(level,state,index))||(state.selection?.zone===zone&&state.selection.ids.includes(index)))return cancel();
    select(level,state,zone,index);return {kind:'selected',moves:[]};
  }
  const result=move(level,state,zone,index);
  return {...result,kind:result.moves.length?'moved':'cancelled'};
}
export function isComplete(level,state){return level.target.every((row,r)=>[...row].every((c,x)=>c==='.'||state.board[r*row.length+x]===c))&&state.tray.every(c=>c===null);}
export function canExpandTray(state){return state.status==='playing'&&state.tray.length<(state.maxTrayCapacity||MAX_TRAY_CAPACITY);}
export function expandTray(state){if(!canExpandTray(state))return false;const step=state.trayStep||TRAY_EXPANSION,max=state.maxTrayCapacity||MAX_TRAY_CAPACITY;state.tray.push(...Array(Math.min(step,max-state.tray.length)).fill(null));state.expanded++;return true;}
export function elapse(state,seconds){if(state.status!=='playing')return;state.remaining=Math.max(0,state.remaining-seconds);if(state.remaining===0){state.status='lost';state.selection=null;}}
export function claimReward(profile,state,multiplier=1,nextLevelId=state.levelId+1){
  if(state.status!=='won'||profile.claimed.includes(state.runId))return false;
  if(multiplier!==1&&multiplier!==2)return false;
  profile.claimed.push(state.runId);profile.coins+=10*multiplier;profile.energy+=5*multiplier;profile.puzzles+=multiplier;
  profile.streak++;profile.bestStreak=Math.max(profile.bestStreak,profile.streak);profile.unlocked=Math.max(profile.unlocked,nextLevelId);profile.tutorialDone=true;
  if(Array.isArray(profile.unlockedLevels)&&!profile.unlockedLevels.includes(nextLevelId))profile.unlockedLevels.push(nextLevelId);
  return true;
}
export function validSession(level,s){
  if(!s)return false;
  const rules=trayRules(level),legacy=Number.isInteger(s.legacyTrayCapacity)&&s.legacyTrayCapacity>rules.maxCapacity&&s.legacyTrayCapacity===s.tray?.length;
  const expectedLength=legacy?s.legacyTrayCapacity:Math.min(rules.maxCapacity,rules.capacity+s.expanded*rules.expansion);
  const expectedMaximum=legacy?s.legacyTrayCapacity:rules.maxCapacity;
  if(!s||s.levelId!==level.id||typeof s.runId!=='string'||!Array.isArray(s.board)||s.board.length!==level.target.length*level.target[0].length||!Array.isArray(s.tray)||!Number.isInteger(s.expanded)||s.expanded<0||s.expanded>rules.maxExpansions||s.tray.length!==expectedLength||s.trayVersion===4&&(s.trayStep!==rules.expansion||s.maxTrayCapacity!==expectedMaximum)||!['playing','won','lost'].includes(s.status)||!Number.isFinite(s.remaining)||s.remaining<0||s.remaining>level.timeLimit)return false;
  const expected={},actual={};
  for(const row of level.target)for(const c of row)if(c!=='.')expected[c]=(expected[c]||0)+1;
  for(let i=0;i<s.board.length;i++){
    if(targetAt(level,i)==='.') {if(s.board[i]!=null)return false;continue;}
    const c=s.board[i];if(c!=null){if(!expected[c])return false;actual[c]=(actual[c]||0)+1;}
  }
  for(const c of s.tray)if(c!==null){if(!expected[c])return false;actual[c]=(actual[c]||0)+1;}
  return Object.keys(expected).every(c=>expected[c]===actual[c])&&(s.status!=='won'||isComplete(level,s));
}
function upgradeTray(level,state){
  const rules=trayRules(level),beads=state.tray.filter(color=>color!=null);
  const expectedMaximum=Number.isInteger(state.legacyTrayCapacity)?state.legacyTrayCapacity:rules.maxCapacity;
  if(state.trayVersion===4&&state.trayStep===rules.expansion&&state.maxTrayCapacity===expectedMaximum)return;
  const preservedExpansions=Math.max(0,Math.min(rules.maxExpansions,Number.isInteger(state.expanded)?state.expanded:0));
  let length=Math.max(rules.capacity+preservedExpansions*rules.expansion,Math.ceil(beads.length/rules.expansion)*rules.expansion);
  length=Math.max(rules.capacity,length);
  state.expanded=Math.min(rules.maxExpansions,Math.max(0,Math.ceil((length-rules.capacity)/rules.expansion)));
  if(length>rules.maxCapacity){state.legacyTrayCapacity=length;state.expanded=rules.maxExpansions;}
  else delete state.legacyTrayCapacity;
  state.tray=[...beads,...Array(length-beads.length).fill(null)];
  state.trayVersion=4;state.trayStep=rules.expansion;state.maxTrayCapacity=state.legacyTrayCapacity||rules.maxCapacity;
}
function restoreSplitColors(level,state){
  for(const split of level.colorSplits||[]){
    const expected=level.target.join(''),inventory=[...state.board,...state.tray];
    const expectedFrom=[...expected].filter(color=>color===split.from).length;
    const expectedTo=[...expected].filter(color=>color===split.to).length;
    const actualFrom=inventory.filter(color=>color===split.from).length;
    const actualTo=inventory.filter(color=>color===split.to).length;
    const needed=expectedTo-actualTo;
    if(needed<=0)continue;
    if(needed!==split.count||actualFrom-expectedFrom!==needed)continue;
    const preferred=[],movable=[],last=[];
    state.board.forEach((color,index)=>{
      if(color!==split.from)return;
      const target=targetAt(level,index);
      (target===split.to?preferred:target===split.from?last:movable).push(['board',index]);
    });
    const tray=[];state.tray.forEach((color,index)=>{if(color===split.from)tray.push(['tray',index]);});
    for(const [zone,index] of [...preferred,...tray,...movable,...last].slice(0,needed))state[zone][index]=split.to;
  }
}
export function readProfile(storage,levels){
  const fresh=defaultProfile();
  try{
    const raw=JSON.parse(storage.getItem(SAVE_KEY));if(!raw||raw.version!==1)return fresh;
    for(const key of ['unlocked','currentLevel','coins','energy','puzzles','streak','bestStreak'])if(Number.isSafeInteger(raw[key])&&raw[key]>=0)fresh[key]=raw[key];
    for(const key of ['tutorialDone','sound'])if(typeof raw[key]==='boolean')fresh[key]=raw[key];
    // Version 2 fills the missing third level and swaps the carrot/Maruko IDs.
    // Explicit access retains old unlocked patterns without unlocking unrelated levels.
    const legacy=raw.levelOrder!==2,remap=id=>id===5?8:id===8?5:id;
    if(legacy){
      const oldLimit=fresh.unlocked===3?4:fresh.unlocked;
      fresh.unlockedLevels=levels.filter(l=>l.id<=oldLimit).map(l=>remap(l.id));
      fresh.currentLevel=remap(fresh.currentLevel);
      if(raw.session)raw.session.levelId=remap(raw.session.levelId);
    }else if(Array.isArray(raw.unlockedLevels))fresh.unlockedLevels=raw.unlockedLevels.filter(id=>Number.isSafeInteger(id)&&id>0);
    else fresh.unlockedLevels=levels.filter(l=>l.id<=fresh.unlocked).map(l=>l.id);
    fresh.unlockedLevels=[...new Set([1,...fresh.unlockedLevels])].sort((a,b)=>a-b);
    fresh.unlocked=Math.max(fresh.unlocked,...fresh.unlockedLevels);
    fresh.claimed=Array.isArray(raw.claimed)?raw.claimed.filter(x=>typeof x==='string'):[];
    const level=levels.find(l=>l.id===raw.session?.levelId);
    // Color-only revisions retain the same board geometry and bead inventory.
    // Distinct new keys make this migration idempotent on subsequent reloads.
    if(level?.colorAliases&&Array.isArray(raw.session.board)&&Array.isArray(raw.session.tray)){
      for(const zone of ['board','tray'])raw.session[zone]=raw.session[zone].map(c=>level.colorAliases[c]||c);
      restoreSplitColors(level,raw.session);
      if(raw.session.status==='playing'&&isComplete(level,raw.session))raw.session.status='won';
    }
    if(level&&Array.isArray(raw.session?.tray))upgradeTray(level,raw.session);
    if(level&&validSession(level,raw.session)){fresh.session=raw.session;fresh.session.selection=null;compactTray(fresh.session);}
  }catch{}
  return fresh;
}

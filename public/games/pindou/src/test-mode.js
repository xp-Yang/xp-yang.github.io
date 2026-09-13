import {locked,targetAt,adjacent,select,move,canExpandTray} from './engine.js';

export const TEST_MODE_KEY='pindou-local-test:enabled';
export const TEST_SAVE_KEY='pindou-local-test:save:v1';
export function isLocalGame(location){
  const host=location.hostname.toLowerCase();
  if(location.protocol==='file:')return true;
  if(!['http:','https:'].includes(location.protocol))return false;
  if(host==='localhost'||host.endsWith('.localhost')||host==='[::1]'||host==='::1')return true;
  const parts=host.split('.').map(Number);
  if(parts.length!==4||!parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255))return false;
  return parts[0]===127||parts[0]===10||(parts[0]===192&&parts[1]===168)||(parts[0]===172&&parts[1]>=16&&parts[1]<=31);
}

// Plan one legal transfer from the current state; the UI performs the real taps.
export function nextAutoMove(level,state,strategy='space'){
  if(strategy==='space'||strategy==='place')return spaceAutoMove(level,state,strategy==='place');
  if(state.status!=='playing')return null;
  const holes=new Map();
  const reverse=strategy==='reverse';
  for(let n=0;n<state.board.length;n++){const i=reverse?state.board.length-1-n:n,color=state.board[i],target=targetAt(level,i);if(color===null&&target!=='.'&&!holes.has(target))holes.set(target,i);}
  for(const zone of ['tray','board'])for(let n=0;n<state[zone].length;n++){
    const index=reverse?state[zone].length-1-n:n;
    const color=state[zone][index];if(!color||(zone==='board'&&locked(level,state,index)))continue;
    if(holes.has(color))return {from:{zone,index},to:{zone:'board',index:holes.get(color)}};
  }
  if(strategy==='store')return spaceAutoMove(level,state);
  const index=reverse?state.board.findLastIndex((color,i)=>color&&!locked(level,state,i)):state.board.findIndex((color,i)=>color&&!locked(level,state,i));
  if(index<0)return null;
  const empty=state.tray.indexOf(null);
  if(empty>=0)return {from:{zone:'board',index},to:{zone:'tray',index:empty}};
  return canExpandTray(state)?{expand:true}:null;
}

const topologies=new WeakMap();
function topology(level){
  if(topologies.has(level))return topologies.get(level);
  const target=level.target.flatMap(row=>[...row]),cells=target.flatMap((c,i)=>c==='.'?[]:[i]);
  const neighbors=new Map(cells.map(i=>[i,adjacent(level,i,true)]));
  const seen=new Set(),regions=[];
  for(const i of cells){if(seen.has(i))continue;const ids=[i];seen.add(i);
    for(let n=0;n<ids.length;n++)for(const j of neighbors.get(ids[n]))if(!seen.has(j)&&target[j]===target[i]){seen.add(j);ids.push(j);}
    regions.push({color:target[i],ids});
  }
  const value={target,cells,neighbors,regions};topologies.set(level,value);return value;
}
function spaceAutoMove(level,state,firstStorage=false){
  if(state.status!=='playing')return null;
  const {target,cells,neighbors,regions}=topology(level),holes=new Map();
  for(const {color,ids} of regions){let count=0,index;
    for(const i of ids)if(state.board[i]===null){count++;index??=i;}
    if(count>(holes.get(color)?.count||0))holes.set(color,{count,index});
  }
  const trayColors=new Map();state.tray.forEach((color,index)=>{if(!color)return;if(!trayColors.has(color))trayColors.set(color,{zone:'tray',index,color,count:0});trayColors.get(color).count++;});
  const groups=[...trayColors.values()],seen=new Set();
  for(const i of cells){const color=state.board[i];if(!color||color===target[i]||seen.has(i))continue;
    const ids=[i];seen.add(i);
    for(let n=0;n<ids.length;n++)for(const j of neighbors.get(ids[n]))if(!seen.has(j)&&state.board[j]===color&&state.board[j]!==target[j]){seen.add(j);ids.push(j);}
    groups.push({zone:'board',index:i,color,count:ids.length});
  }
  let best=null,score=0;
  for(const group of groups){const hole=holes.get(group.color),amount=Math.min(group.count,hole?.count||0);
    if(amount>score){score=amount;best={from:{zone:group.zone,index:group.index},to:{zone:'board',index:hole.index}};}
  }
  if(best)return best;
  const free=state.tray.filter(c=>c===null).length,index=state.tray.indexOf(null);
  if(firstStorage&&free){const group=groups.find(g=>g.zone==='board');if(group)return {from:{zone:'board',index:group.index},to:{zone:'tray',index}};}
  for(const group of groups)if(group.zone==='board'&&Math.min(group.count,free)>score){
    score=Math.min(group.count,free);best={from:{zone:'board',index:group.index},to:{zone:'tray',index}};
  }
  return best||(canExpandTray(state)?{expand:true}:null);
}

// Legacy comparison only. The app uses staged-auto.js and never falls back here.
// Compare complete legal rollouts, not just the size of the next transfer.
// Yield in short slices on browsers without workers; cancellation never changes live state.
export async function planAutoMoves(level,state,{cancelled=()=>false,yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  const candidates=[];let slice=performance.now();
  for(const strategy of ['first','space',...(state.board.length<1000?['store','place','reverse']:[])]){
    const copy={...state,board:state.board.slice(),tray:state.tray.slice(),selection:null},steps=[];
    while(copy.status==='playing'&&steps.length<copy.board.length*4){
      if(cancelled())return null;
      const plan=nextAutoMove(level,copy,strategy);if(!plan||plan.expand)break;
      if(!select(level,copy,plan.from.zone,plan.from.index))break;
      if(!move(level,copy,plan.to.zone,plan.to.index).moves.length)break;
      steps.push(plan);
      if(performance.now()-slice>=8){await yieldControl();slice=performance.now();}
    }
    if(copy.status==='won')candidates.push({strategy,steps});
  }
  return candidates.sort((a,b)=>a.steps.length-b.steps.length||Number(b.strategy==='space')-Number(a.strategy==='space'))[0]||null;
}

import {adjacent,select,move} from './engine.js';
import {currentAutoColor} from './auto-colors.js';

// All simulated and played actions use the engine. Only candidate ranking lives here.
const topologies=new WeakMap();
export function autoTopology(level){
  if(topologies.has(level))return topologies.get(level);
  const target=level.target.flatMap(r=>[...r]),cells=target.flatMap((c,i)=>c==='.'?[]:[i]);
  const neighbors=target.map((_,i)=>target[i]==='.'?[]:adjacent(level,i,true));
  const regionAt=Array(target.length).fill(-1),regions=[];
  for(const i of cells){if(regionAt[i]>=0)continue;const id=regions.length,ids=[i];regionAt[i]=id;
    for(let n=0;n<ids.length;n++)for(const j of neighbors[ids[n]])if(regionAt[j]<0&&target[j]===target[i]){regionAt[j]=id;ids.push(j);}
    regions.push({color:target[i],ids});
  }
  const value={target,cells,neighbors,regionAt,regions,width:level.target[0].length};topologies.set(level,value);return value;
}
export const initialAutoPhase=()=>({phase:'fill',round:0});
export function copyAutoState(state){return {...state,board:state.board.slice(),tray:state.tray.slice(),selection:state.selection?{...state.selection,ids:state.selection.ids.slice()}:null};}
export function selectionMatches(state,selection){
  const s=state.selection;
  return !!s&&s.zone===selection.zone&&s.color===selection.color&&s.anchor===selection.anchor&&s.ids.length===selection.ids.length&&s.ids.every((i,n)=>i===selection.ids[n]);
}
export function executeAutoStep(level,state,step){
  if(step.retain){if(!selectionMatches(state,step.selection))throw Error('Retained selection changed');}
  else {state.selection=null;if(!select(level,state,step.from.zone,step.from.index))throw Error('Invalid auto source');}
  const result=move(level,state,step.to.zone,step.to.index);
  if(!result.moves.length)throw Error('Invalid auto destination');
  return result;
}
export function describeAutoState(level,state){
  const t=autoTopology(level),seen=new Set(),groups=[],trayGroups=new Map();
  for(const i of t.cells){const color=state.board[i];if(!color||color===t.target[i]||seen.has(i))continue;
    const ids=[i];seen.add(i);
    for(let n=0;n<ids.length;n++)for(const j of t.neighbors[ids[n]])if(!seen.has(j)&&state.board[j]===color&&color!==t.target[j]){seen.add(j);ids.push(j);}
    ids.sort((a,b)=>a-b);groups.push({zone:'board',color,ids});
  }
  state.tray.forEach((color,i)=>{if(!color)return;if(!trayGroups.has(color))trayGroups.set(color,{zone:'tray',color,ids:[]});trayGroups.get(color).ids.push(i);});
  const holes=t.regions.map(r=>({...r,holes:r.ids.filter(i=>state.board[i]===null)}));
  return {t,groups,trayGroups:[...trayGroups.values()],holes,free:state.tray.filter(c=>c===null).length,maxGroup:Math.max(0,...groups.map(g=>g.ids.length))};
}
export function sourceAnchors(group,t){
  if(group.zone==='tray')return [group.ids[0]];
  const regions=new Map();for(const i of group.ids){const r=t.regionAt[i];if(!regions.has(r))regions.set(r,[]);regions.get(r).push(i);}
  const concentrated=[...regions.values()].sort((a,b)=>b.length-a.length||a[0]-b[0]);
  return [...new Set([group.ids[0],group.ids.at(-1),...concentrated.slice(0,2).map(ids=>ids[0])])];
}
function ordered(ids,anchor,width){const d=i=>(i%width-anchor%width)**2+(Math.floor(i/width)-Math.floor(anchor/width))**2;return ids.slice().sort((a,b)=>d(a)-d(b)||a-b);}
function compare(a,b){for(let i=0;i<a.rank.length;i++){const d=b.rank[i]-a.rank[i];if(d)return d;}return a.key.localeCompare(b.key);}
function fragmentation(ids,t){
  const remaining=new Set(ids);let count=0,singletons=0;
  for(const i of ids){if(!remaining.delete(i))continue;count++;const queue=[i];for(let n=0;n<queue.length;n++)for(const j of t.neighbors[queue[n]])if(remaining.delete(j))queue.push(j);if(queue.length===1)singletons++;}
  return {count,singletons};
}
// Transitions happen without charging a batch. Occupied target cells connect holes.
export function autoCandidates(level,state,continuation=initialAutoPhase()){
  const d=describeAutoState(level,state),fsm={...continuation},sources=[...d.groups,...d.trayGroups];
  const focus=fsm.colorPriority?currentAutoColor(level,state):null;
  if(fsm.colorPriority)fsm.currentColor=focus?.color??null;
  if(state.selection?.ids.length)sources.push({...state.selection,retain:true});
  const protectedIds=fsm.phase==='drain'?new Set(fsm.target.ids):null;
  let trayDistance=null;
  if(protectedIds||focus){
    // Reverse color dependencies: placing color X exposes its source underlay Y.
    // If Y cannot lead to any stored color even in this optimistic graph, that
    // board move cannot help empty the tray while the target remains protected.
    const reverse=new Map();
    for(const g of d.groups){if(protectedIds&&g.ids.some(i=>protectedIds.has(i)))continue;
      for(const i of g.ids){const target=d.t.target[i];if(!reverse.has(target))reverse.set(target,new Set());reverse.get(target).add(g.color);}
    }
    trayDistance=new Map(d.trayGroups.map(g=>[g.color,0]));const queue=[...trayDistance.keys()];
    for(let n=0;n<queue.length;n++)for(const color of reverse.get(queue[n])||[])if(!trayDistance.has(color)){trayDistance.set(color,trayDistance.get(queue[n])+1);queue.push(color);}
  }
  const board=[],tray=[],storage=[],largestByColor=new Map();
  for(const g of d.groups)largestByColor.set(g.color,Math.max(largestByColor.get(g.color)||0,g.ids.length));
  for(const g of sources){
    if(protectedIds&&g.zone==='board'&&g.ids.some(i=>protectedIds.has(i)))continue;
    const destinations=d.holes.filter(h=>h.color===g.color&&h.holes.length).map(h=>({zone:'board',index:h.holes[0],capacity:h.holes.length}));
    if(g.zone==='board'&&d.free)destinations.push({zone:'tray',index:state.tray.indexOf(null),capacity:d.free});
    let anchors=g.retain?[g.anchor]:sourceAnchors(g,d.t);
    // A partial collection must be able to start at a blocker of the active
    // color, even if that cell is absent from the usual four representatives.
    if(focus&&!g.retain&&g.zone==='board'){
      const blocker=g.ids.find(i=>d.t.target[i]===focus.color);
      if(blocker!==undefined&&!anchors.includes(blocker))anchors=[blocker,...anchors].slice(0,4);
    }
    for(const anchor of anchors){
      const ids=g.retain||g.zone==='tray'?g.ids:ordered(g.ids,anchor,d.t.width);
      for(const to of destinations){
        const amount=Math.min(ids.length,to.capacity),underlay=new Map();
        if(g.zone==='board')for(const i of ids.slice(0,amount)){const r=d.t.regionAt[i];underlay.set(r,(underlay.get(r)||0)+1);}
        const concentration=Math.max(0,...underlay.values());let nextBatch=0;
        for(const [r,n] of underlay)nextBatch=Math.max(nextBatch,Math.min(n+d.holes[r].holes.length,largestByColor.get(d.holes[r].color)||0));
        const placed=to.zone==='board'?amount:0;
        const step={from:{zone:g.zone,index:anchor},to:{zone:to.zone,index:to.index},retain:!!g.retain};
        if(g.retain)step.selection={zone:g.zone,color:g.color,anchor:g.anchor,ids:g.ids.slice()};
        const openedFocus=focus&&g.zone==='board'?ids.slice(0,amount).filter(i=>d.t.target[i]===focus.color).length:0;
        const c={step,color:g.color,openedFocus,amount,placed,concentration,nextBatch,remaining:g.zone==='board'?ids.slice(amount):[],key:`${g.zone}:${String(anchor).padStart(6,'0')}:${to.zone}:${String(to.index).padStart(6,'0')}:${g.retain?0:1}`};
        if(trayDistance&&g.zone==='board')c.trayDistance=Math.min(Infinity,...ids.slice(0,amount).map(i=>trayDistance.get(d.t.target[i])??Infinity));
        c.openedRegions=[...underlay];
        (to.zone==='tray'?storage:g.zone==='board'?board:tray).push(c);
      }
    }
  }
  let allowed=[];
  let colorReason=null;
  if(focus){
    // Admission precedes the cap: finish the active color before later colors.
    const placements=[...board,...tray].filter(c=>c.color===focus.color);
    const blockers=storage.filter(c=>c.openedFocus>0);
    const bridges=board.filter(c=>c.openedFocus>0);
    const coalesce=fsm.reduceSingles&&fsm.phase!=='drain'&&placements.length&&Math.max(...placements.map(c=>c.amount))===1?
      blockers.filter(c=>c.amount>1&&c.openedRegions.some(([region,n])=>{
        const h=d.holes[region];
        const supply=Math.max(largestByColor.get(focus.color)||0,d.trayGroups.find(g=>g.color===focus.color)?.ids.length||0,state.selection?.color===focus.color?state.selection.ids.length:0);
        return h.color===focus.color&&h.holes.length>0&&Math.min(supply,h.holes.length+n)>1;
      })):[];
    if(coalesce.length){allowed=coalesce;colorReason='coalesce';}
    else if(placements.length){allowed=placements;colorReason='focus';}
    else if(fsm.phase!=='drain'&&blockers.length){allowed=blockers;colorReason='open-color';}
    else if(bridges.length){allowed=bridges;colorReason='unblock-color';}
    else if(tray.length){allowed=tray;colorReason='free-tray';}
    else {allowed=board.filter(c=>Number.isFinite(c.trayDistance));colorReason='bridge-tray';}
    if(fsm.phase!=='drain'){
      fsm.phase=['open-color','coalesce'].includes(colorReason)?(fsm.phase==='refill'?'refill':'fill'):
        allowed[0]?.step.from.zone==='tray'?'tray-cleanup':'large';
    }
  }else for(let transitions=0;transitions<8;transitions++){
    if(fsm.phase==='drain'){
      allowed=tray.length?tray:board.filter(c=>Number.isFinite(c.trayDistance));break;
    }else if(fsm.phase==='fill'||fsm.phase==='refill'){
      if(storage.length){allowed=storage;break;}fsm.phase='large';
    }else if(fsm.phase==='large'){
      if(d.maxGroup<=3){fsm.phase='collect';fsm.round=1;continue;}
      const large=board.filter(c=>c.amount>=4);
      if(large.length){allowed=large;break;}
      // Small board moves may expose the next link. Tray placement is a last resort.
      if(board.length){allowed=board;break;}
      const storeLarge=storage.filter(c=>c.amount>=4);
      if(storeLarge.length){allowed=storeLarge;break;}
      if(tray.length){allowed=tray;break;}
      if(storage.length){allowed=storage;break;}
      break;
    }else if(fsm.phase==='collect'){
      if(storage.length){allowed=storage;break;}fsm.phase='board-cleanup';
    }else if(fsm.phase==='board-cleanup'){
      if(board.length){allowed=board;break;}fsm.phase='tray-cleanup';
    }else if(fsm.phase==='tray-cleanup'){
      if(tray.length){allowed=tray;break;}
      if(!d.groups.length)break;
      fsm.phase='collect';fsm.round++;
    }else throw Error('Unknown auto phase');
  }
  // Cheap admission limits the expensive fragmentation and real-engine simulations.
  for(const c of allowed){
    if(focus){
      c.rank=[c.openedFocus,c.placed,c.amount,-(c.trayDistance||0),c.concentration,0];
      if(colorReason==='focus')c.rank=[c.amount,Number(c.step.from.zone==='tray'),c.openedFocus,c.nextBatch,c.concentration,0];
      if(colorReason==='bridge-tray')c.rank=[-(c.trayDistance||0),c.amount,c.openedFocus,c.nextBatch,c.concentration,0];
      c.step.colorPriority={color:focus.color,total:focus.count,remaining:focus.remaining,reason:colorReason};
    }else if(fsm.phase==='drain'){
      const stored=new Map(d.trayGroups.map(g=>[g.color,g.ids.length])),opened=new Map();
      if(c.step.from.zone==='board'){
        const g=c.step.retain?state.selection:d.groups.find(g=>g.ids.includes(c.step.from.index));
        const ids=c.step.retain?g.ids:ordered(g.ids,c.step.from.index,d.t.width);
        for(const i of ids.slice(0,c.amount)){const color=d.t.target[i];opened.set(color,(opened.get(color)||0)+1);}
      }
      c.trayOpportunity=[...opened].reduce((n,[color,count])=>n+Math.min(count,stored.get(color)||0),0);
      c.rank=[Number(c.step.from.zone==='tray')*c.amount,-(c.trayDistance||0),c.trayOpportunity,c.amount,c.concentration,0];
    }else c.rank=[c.placed,c.step.to.zone==='tray'?c.amount:c.nextBatch,c.concentration,c.nextBatch,0];
  }
  allowed.sort(compare);allowed=allowed.slice(0,24);
  for(const c of allowed){const fragments=fragmentation(c.remaining,d.t);c.fragments=fragments.count;c.singletons=fragments.singletons;if(focus&&fsm.reduceSingles)c.rank.splice(-1,1,-c.singletons,-c.fragments);else if(focus||fsm.phase==='drain')c.rank[c.rank.length-1]=-c.fragments;else c.rank=[c.placed,c.step.to.zone==='tray'?c.amount:c.nextBatch,c.concentration,c.nextBatch,-c.fragments];c.step.phase=fsm.phase;c.step.round=fsm.round;}
  allowed.sort(compare);
  return {candidates:allowed,continuation:fsm,description:d};
}
export function autoStateKey(state,fsm){
  // JSON retains null/void, color, tray order, and *ordered* residual selection.
  return JSON.stringify([state.board,state.tray,fsm.phase,fsm.round,fsm.restartCount||0,fsm.target||null,fsm.queue?.cursor??null,fsm.search?.groupIndex??null,state.selection,!!fsm.colorPriority,fsm.currentColor??null,!!fsm.reduceSingles]);
}
function simulated(level,state,c){const copy=copyAutoState(state),result=executeAutoStep(level,copy,c.step);return {state:copy,moved:result.moves.length};}
function largestPlacement(level,state){
  const d=describeAutoState(level,state);let amount=0;
  for(const g of [...d.groups,...d.trayGroups,...(state.selection?[state.selection]:[])])for(const h of d.holes)if(g.color===h.color)amount=Math.max(amount,Math.min(g.ids.length,h.holes.length));
  return amount;
}
export async function chooseAutoLookAhead(level,state,fsm,check){
  let beam=[{state,fsm,first:null,rank:[0,0,0,0],key:''}],best=null;
  for(let depth=0;depth<3;depth++){
    const paths=[],seen=new Set();
    for(const node of beam){
      if(node.state.status==='won'){paths.push(node);continue;}
      const {candidates,continuation}=autoCandidates(level,node.state,node.fsm);
      for(const c of candidates){
        if(await check())return null;
        const next=simulated(level,node.state,c),key=autoStateKey(next.state,continuation);if(seen.has(key))continue;seen.add(key);
        const singleMoves=(node.singleMoves||0)+Number(c.amount===1);
        paths.push({state:next.state,fsm:continuation,first:node.first||c,singleMoves,
          rank:fsm.reduceSingles?[-singleMoves,largestPlacement(level,next.state),c.concentration,-c.singletons]:[node.rank[0]+c.placed,largestPlacement(level,next.state),node.rank[2]+c.concentration,node.rank[3]-c.fragments],key:node.key+c.key});
      }
    }
    paths.sort(compare);beam=paths.slice(0,6);best=beam[0];if(!best)break;
  }
  return best?.first;
}

export async function planAutoMoves(level,input,{budgetMs=15000,continuation=initialAutoPhase(),cancelled=()=>false,yieldControl=()=>new Promise(r=>setTimeout(r,0)),now=()=>performance.now(),improve=true,maxSteps=Infinity}={}){
  const start=now();let slice=start,expired=false;
  const check=async()=>{
    if(cancelled())return true;
    if(now()-slice>=8){await yieldControl();slice=now();}
    expired=now()-start>=budgetMs;return expired||cancelled();
  };
  if(cancelled())return null;
  async function rollout(deep){
    let state=copyAutoState(input),fsm={...continuation};const steps=[];
    const result=complete=>({steps,complete,continuation:{...fsm,selection:state.selection?{...state.selection,ids:state.selection.ids.slice()}:null}});
    while(state.status==='playing'){
      if(await check()&&steps.length)return result(false);
      if(cancelled())return null;
      const options=autoCandidates(level,state,fsm);fsm=options.continuation;
      let candidate=options.candidates[0];if(!candidate)throw Error('Phase strategy stalled');
      if(deep){const choice=await chooseAutoLookAhead(level,state,fsm,check);if(!choice)return result(false);candidate=choice;}
      executeAutoStep(level,state,candidate.step);steps.push(candidate.step);
      if(steps.length>=maxSteps)return result(state.status==='won');
    }
    return result(true);
  }
  let best=await rollout(false);if(!best||cancelled())return null;
  const greedyBatches=best.steps.length;
  if(best.complete&&improve&&!expired&&maxSteps===Infinity){const candidate=await rollout(true);if(cancelled())return null;if(candidate?.complete&&candidate.steps.length<best.steps.length)best=candidate;}
  return {...best,strategy:'staged',planningMs:now()-start,greedyBatches};
}

// Continue unfinished baselines while earlier batches animate. The worker owns the
// projected state; it never reads or mutates the live session after dispatch.
export async function streamAutoPlans(level,input,options,deliver){
  let state=copyAutoState(input),continuation=initialAutoPhase(),append=false;
  while(state.status==='playing'){
    const result=await planAutoMoves(level,state,{...options,continuation,...(append?{budgetMs:250,improve:false,maxSteps:64}:{})});
    if(!result||options.cancelled?.())return;
    for(const step of result.steps)executeAutoStep(level,state,step);
    deliver({result,append});if(result.complete)return;
    continuation=result.continuation;append=true;
    await (options.yieldControl?.()||new Promise(r=>setTimeout(r,0)));
  }
}

import {autoCandidates,autoTopology,autoStateKey,copyAutoState,describeAutoState,executeAutoStep,initialAutoPhase,sourceAnchors,chooseAutoLookAhead} from './staged-auto.js';
import {select} from './engine.js';
import {currentAutoColor} from './auto-colors.js';

const freeSlots=state=>state.tray.filter(c=>c===null).length;
function compare(a,b){for(let i=0;i<a.rank.length;i++){const delta=b.rank[i]-a.rank[i];if(delta)return delta;}return a.key.localeCompare(b.key);}
function newHoles(level,moves){
  const regions=new Map(),t=autoTopology(level);
  for(const m of moves){const r=t.regionAt[m.from];regions.set(r,(regions.get(r)||0)+1);}
  const sorted=[...regions].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
  return {count:moves.length,largest:sorted[0]?.[1]||0,regions:sorted.map(([region,count])=>({region,count}))};
}
export function startRestartSearch(level,state,fsm,fallback){
  const d=describeAutoState(level,state);
  const focus=fsm.colorPriority?currentAutoColor(level,state):null;
  const groups=d.groups.filter(g=>g.ids.length>=6&&(!focus||g.ids.some(i=>d.t.target[i]===focus.color))).map(g=>{
    const anchors=sourceAnchors(g,d.t);let potential=0;
    if(focus){const blocker=g.ids.find(i=>d.t.target[i]===focus.color);if(!anchors.includes(blocker)){anchors.unshift(blocker);anchors.splice(4);}}
    for(const anchor of anchors){const selected={...state,selection:null};select(level,selected,'board',anchor);
      potential=Math.max(potential,newHoles(level,selected.selection.ids.slice(0,96).map(from=>({from}))).largest);
    }
    return {...g,anchors,potential,rank:[focus?g.ids.filter(i=>d.t.target[i]===focus.color).length:0,Math.min(96,g.ids.length),potential],key:String(g.ids[0]).padStart(6,'0')};
  }).sort(compare).slice(0,4);
  return {groups,groupIndex:0,current:null,best:null,fallback,triggerPhase:fsm.phase,triggerAmount:fallback.amount};
}
function drainContext(fsm,group){return {phase:'drain',round:fsm.round,restartCount:fsm.restartCount||0,target:{ids:group.ids,color:group.color},colorPriority:!!fsm.colorPriority,reduceSingles:!!fsm.reduceSingles};}
function drainRank(level,state,steps){
  const d=describeAutoState(level,state);let next=0;
  for(const g of d.trayGroups)for(const h of d.holes)if(h.color===g.color)next=Math.max(next,Math.min(g.ids.length,h.holes.length));
  return [d.free,next,steps.reduce((n,s)=>n+(s.placed||0),0),-steps.length];
}
// A resumable beam is used when emptying the tray needs board-to-board bridges.
// Direct tray placements are already monotone, so their best-ranked action is
// taken without expanding three identical storage-free layers on every bead.
async function advanceProbe(level,probe,fsm,check){
  while(probe.depth<3){
    while(probe.nodeIndex<probe.beam.length){
      if(await check())return false;
      const node=probe.beam[probe.nodeIndex];
      if(!probe.candidates){
        probe.candidates=freeSlots(node.state)===node.state.tray.length?[]:autoCandidates(level,node.state,fsm).candidates.slice(0,node.state.board.length>1000?6:24);
        probe.candidateIndex=0;
        if(!probe.candidates.length)probe.paths.push(node);
      }
      while(probe.candidateIndex<probe.candidates.length){
        if(await check())return false;
        const c=probe.candidates[probe.candidateIndex++],state=copyAutoState(node.state);
        executeAutoStep(level,state,c.step);
        const identity=autoStateKey(state,fsm);if(probe.seen.has(identity))continue;probe.seen.add(identity);
        const steps=[...node.steps,c];
        probe.paths.push({state,steps,rank:drainRank(level,state,steps),key:node.key+c.key});
      }
      probe.nodeIndex++;probe.candidates=null;
    }
    probe.paths.sort(compare);probe.beam=probe.paths.slice(0,6);
    probe.paths=[];probe.seen=new Set();probe.nodeIndex=0;probe.depth++;
  }
  probe.choice=probe.beam[0]?.steps||[];return true;
}

// search is serializable: a deadline may interrupt any candidate, anchor or beam
// layer without restarting its evaluation or publishing speculative movements.
export async function advanceRestartSearch(level,root,fsm,search,check){
  while(search.groupIndex<search.groups.length){
    if(await check())return false;
    const group=search.groups[search.groupIndex],context=drainContext(fsm,group);
    // With a cleared tray, a smaller exact new-hole bound cannot beat the best
    // route, regardless of how cheaply it could drain. Avoid replaying it.
    if(!search.current&&search.best?.trayCleared&&group.potential<search.best.expectedHoles.largest){search.groupIndex++;continue;}
    if(!search.current)search.current={state:copyAutoState(root),steps:[],probe:null,finishing:false,anchorIndex:0,
      reuse:!fsm.colorPriority&&search.best?.trayCleared?{steps:search.best.steps.slice(0,-1),cursor:0}:null};
    const current=search.current;
    if(fsm.colorPriority&&current.steps.length){
      // The outer scheduler supersedes the old drain-to-empty objective once
      // this verified prefix lets the priority color advance. Do not spend
      // minutes searching a suffix that playback would immediately discard.
      const next=autoCandidates(level,current.state,{...fsm,phase:'large',target:undefined}).candidates[0];
      if(['focus','open-color','unblock-color'].includes(next?.step.colorPriority.reason)){
        search.relief=current.steps;return true;
      }
    }
    // A verified route that emptied the tray can serve another protected group
    // too, provided none of its actual sources touch that group.
    if(current.reuse){
      const protectedIds=new Set(group.ids);
      while(current.reuse.cursor<current.reuse.steps.length){
        if(await check())return false;
        const step=current.reuse.steps[current.reuse.cursor++],result=executeAutoStep(level,current.state,step);
        if(result.moves.some(m=>m.fromZone==='board'&&protectedIds.has(m.from))){current.state=copyAutoState(root);current.steps=[];break;}
        current.steps.push(step);
      }
      current.reuse=null;
    }
    if(!current.finishing){
      const options=freeSlots(current.state)===current.state.tray.length?[]:autoCandidates(level,current.state,context).candidates;
      if(!options.length)current.finishing=true;
      else {
        let chosen;
        if(current.probe){if(!await advanceProbe(level,current.probe,context,check))return false;chosen=current.probe.choice;}
        else if(options[0].step.from.zone==='tray'||options[0].trayOpportunity>0||options.length===1)chosen=[options[0]];
        else {
          current.probe={depth:0,beam:[{state:copyAutoState(current.state),steps:[],rank:[0,0,0,0],key:''}],paths:[],seen:new Set(),nodeIndex:0,candidates:null,candidateIndex:0};
          if(!await advanceProbe(level,current.probe,context,check))return false;chosen=current.probe.choice;
        }
        current.probe=null;
        if(chosen.length){for(const candidate of chosen){executeAutoStep(level,current.state,candidate.step);current.steps.push(candidate.step);}continue;}
        current.finishing=true;
      }
    }
    // Reaching the minimum does not stop draining: this is reached only after
    // an empty tray, or after all protected-target-compatible moves run out.
    const free=freeSlots(current.state),minimum=Math.min(group.ids.length,96);
    if(free>=minimum){
      while(current.anchorIndex<group.anchors.length){
        if(await check())return false;
        const anchor=group.anchors[current.anchorIndex++],state=copyAutoState(current.state);
        const deposit={from:{zone:'board',index:anchor},to:{zone:'tray',index:state.tray.indexOf(null)},retain:false,phase:'refill',round:fsm.round};
        const result=executeAutoStep(level,state,deposit),holes=newHoles(level,result.moves);
        if(result.moves.length!==minimum||result.moves.length<6)throw Error('Restart deposit changed size');
        const candidate={steps:[...current.steps,deposit],target:{ids:group.ids,color:group.color,anchor},minimumSlots:minimum,freeBeforeDeposit:free,
          trayCleared:free===state.tray.length,expectedHoles:holes,drainBatches:current.steps.length,
          rank:[free,holes.largest,-current.steps.length],key:String(anchor).padStart(6,'0')};
        if(!search.best||compare(candidate,search.best)<0)search.best=candidate;
      }
    }
    search.current=null;search.groupIndex++;
  }
  return true;
}

function commitRestart(fsm,search){
  const best=search.best,id=(fsm.restartCount||0)+1;
  const info={id,target:best.target,minimumSlots:best.minimumSlots,freeBeforeDeposit:best.freeBeforeDeposit,trayCleared:best.trayCleared,
    expectedHoles:best.expectedHoles,drainBatches:best.drainBatches,triggerAmount:search.triggerAmount,triggerPhase:search.triggerPhase,triggerStep:search.fallback.step};
  fsm.restartCount=id;fsm.target=best.target;
  fsm.queue={cursor:0,steps:best.steps.map((step,index)=>({...step,restart:{...info,first:index===0,deposit:index===best.steps.length-1}}))};
  fsm.phase=best.steps[0].phase;delete fsm.search;
}

function commitColorRelief(fsm,steps){
  fsm.colorReliefs=(fsm.colorReliefs||0)+1;
  fsm.queue={cursor:0,colorRelief:true,steps:steps.map(step=>({...step,colorRelief:true}))};
  delete fsm.search;delete fsm.target;
}

export async function planAutoMoves(level,input,{budgetMs=15000,continuation=initialAutoPhase(),colorPriority=true,reduceSingles=true,cancelled=()=>false,yieldControl=()=>new Promise(r=>setTimeout(r,0)),now=()=>performance.now(),improve=true,maxSteps=Infinity}={}){
  const start=now();let slice=start,expired=false;
  const check=async()=>{
    if(cancelled())return true;
    if(now()-slice>=8){await yieldControl();slice=now();}
    expired=now()-start>=budgetMs;return expired||cancelled();
  };
  if(cancelled())return null;
  async function rollout(deep){
    const state=copyAutoState(input);let fsm={...structuredClone(continuation),colorPriority,reduceSingles:colorPriority&&reduceSingles};const steps=[];let singleMoves=0;
    const result=complete=>({steps,singleMoves,complete,pending:!!fsm.search,continuation:{...fsm,selection:state.selection?{...state.selection,ids:state.selection.ids.slice()}:null}});
    while(state.status==='playing'){
      if(await check()&&(steps.length||fsm.search))return result(false);
      if(cancelled())return null;
      let step;
      if(fsm.search){
        if(!await advanceRestartSearch(level,state,fsm,fsm.search,check))return result(false);
        if(fsm.search.relief)commitColorRelief(fsm,fsm.search.relief);
        else if(fsm.search.best)commitRestart(fsm,fsm.search);
        else {step=fsm.search.fallback.step;delete fsm.search;}
      }
      if(!step&&fsm.queue){
        // A verified restart is interruptible by the outer color scheduler.
        // Once the active color can be placed, do not play stale drain/deposit
        // actions ahead of it. Discard the suffix and re-plan from this state.
        if(colorPriority){
          const priority=autoCandidates(level,state,{...fsm,phase:'large',target:undefined}).candidates[0];
          const queued=fsm.queue.steps[fsm.queue.cursor];
          const sourceColor=queued.retain?queued.selection.color:state[queued.from.zone][queued.from.index];
          const reason=priority?.step.colorPriority.reason;
          const different=queued.from.zone!==priority?.step.from.zone||queued.from.index!==priority?.step.from.index||queued.to.zone!==priority?.step.to.zone||queued.to.index!==priority?.step.to.index||queued.retain!==priority?.step.retain;
          if((reason==='focus'&&(queued.to.zone!=='board'||sourceColor!==priority.color))||
            ((reason==='open-color'||reason==='unblock-color')&&different)){
            delete fsm.queue;delete fsm.target;fsm.phase='large';fsm.interruptedRestarts=(fsm.interruptedRestarts||0)+1;step=priority.step;
          }
        }
      }
      if(!step&&fsm.queue){
        step=fsm.queue.steps[fsm.queue.cursor++];fsm.phase=step.phase;
        if(fsm.queue.cursor===fsm.queue.steps.length){fsm.phase=fsm.queue.colorRelief?'large':'refill';delete fsm.queue;delete fsm.target;}
      }
      if(!step){
        const options=autoCandidates(level,state,fsm);fsm=options.continuation;
        let candidate=options.candidates[0];if(!candidate)throw Error('Refill strategy stalled');
        if(deep){const choice=await chooseAutoLookAhead(level,state,fsm,check);if(!choice)return result(false);candidate=choice;}
        const advancingColor=['focus','open-color','unblock-color','coalesce'].includes(candidate.step.colorPriority?.reason);
        if(candidate.amount<=5&&!advancingColor&&fsm.phase!=='refill'&&options.description.maxGroup>=6){
          fsm.search=startRestartSearch(level,state,fsm,candidate);continue;
        }
        step=candidate.step;
      }
      if(colorPriority){
        const focus=currentAutoColor(level,state);
        // Queue steps were planned against protected groups; stamp the actual
        // active color at execution, including after a color completes mid-queue.
        step={...step,colorPriority:{...step.colorPriority,color:focus?.color,total:focus?.count,remaining:focus?.remaining}};
      }
      const transfer=executeAutoStep(level,state,step);singleMoves+=Number(transfer.moves.length===1);steps.push({...step,amount:transfer.moves.length});
      if(steps.length>=maxSteps)return result(state.status==='won');
    }
    return result(true);
  }
  let best=await rollout(false);if(!best||cancelled())return null;
  const greedyBatches=best.steps.length;
  if(best.complete&&improve&&!expired&&maxSteps===Infinity){const candidate=await rollout(true);if(cancelled())return null;if(candidate?.complete&&(colorPriority&&reduceSingles?candidate.singleMoves<best.singleMoves||(candidate.singleMoves===best.singleMoves&&candidate.steps.length<best.steps.length):candidate.steps.length<best.steps.length))best=candidate;}
  return {...best,strategy:colorPriority?'color-refill':'refill',planningMs:now()-start,greedyBatches};
}

export async function streamAutoPlans(level,input,options,deliver){
  const state=copyAutoState(input);let continuation=initialAutoPhase(),append=false;
  while(state.status==='playing'){
    const result=await planAutoMoves(level,state,{...options,continuation,...(append?{budgetMs:250,improve:false,maxSteps:64}:{})});
    if(!result||options.cancelled?.())return;
    for(const step of result.steps)executeAutoStep(level,state,step);
    continuation=result.continuation;
    // Search snapshots stay in the worker. The UI only receives executable steps
    // and a compact waiting marker, avoiding repeated multi-megabyte clones.
    const {search,queue,...publicContinuation}=continuation;
    deliver({result:{...result,continuation:publicContinuation},append});if(result.complete)return;
    append=true;await (options.yieldControl?.()||new Promise(r=>setTimeout(r,0)));
  }
}

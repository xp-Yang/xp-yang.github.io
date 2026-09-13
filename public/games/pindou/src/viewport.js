export const BOARD_TOP=0,BOARD_BOTTOM=1280;
export const TRAY_SLOT_SIZE=28,TRAY_BEAD_SIZE=26;
export const TRAY_GAP_X=8,TRAY_GAP_Y=10;
export const TRAY_PITCH_X=TRAY_SLOT_SIZE+TRAY_GAP_X,TRAY_PITCH_Y=TRAY_SLOT_SIZE+TRAY_GAP_Y;
export const COMPACT_TRAY_SLOT_SIZE=12,COMPACT_TRAY_BEAD_SIZE=11,COMPACT_TRAY_GAP=3;
export const TRAY_EXPAND_WIDTH=31,TRAY_EXPAND_HEIGHT=22;
const geometryCache=new WeakMap();
export function geometry(level){
  if(geometryCache.has(level))return geometryCache.get(level);
  const cells=[],width=level.target[0].length;
  for(let r=0;r<level.target.length;r++)for(let c=0;c<width;c++)if(level.target[r][c]!=='.')cells.push({index:r*width+c,color:level.target[r][c],x:level.board.x+c*level.board.pitch,y:level.board.y+r*level.board.pitch});
  const result={cells,left:Math.min(...cells.map(p=>p.x)),right:Math.max(...cells.map(p=>p.x)),top:Math.min(...cells.map(p=>p.y)),bottom:Math.max(...cells.map(p=>p.y))};
  geometryCache.set(level,result);return result;
}
export function layout(level,state){
  const compact=level.id===9;
  const traySlotSize=compact?COMPACT_TRAY_SLOT_SIZE:TRAY_SLOT_SIZE,trayBeadSize=compact?COMPACT_TRAY_BEAD_SIZE:TRAY_BEAD_SIZE;
  const trayPitchY=compact?traySlotSize+COMPACT_TRAY_GAP:TRAY_PITCH_Y,padding=compact?10:12;
  const outerMargin=12,expandGap=8,trayWidth=720-outerMargin*2-expandGap-TRAY_EXPAND_WIDTH,innerWidth=trayWidth-padding*2;
  const minimumGap=compact?2:6,maxCols=Math.max(1,Math.floor((innerWidth+minimumGap)/(traySlotSize+minimumGap)));
  const cols=Math.min(maxCols,state.tray.length),rows=Math.ceil(state.tray.length/cols);
  const trayPitchX=cols>1?(innerWidth-traySlotSize)/(cols-1):0;
  const trayHeight=Math.max(48,(rows-1)*trayPitchY+traySlotSize+padding*2),trayBottom=1264,trayTop=trayBottom-trayHeight;
  const trayLeft=outerMargin,trayX=trayLeft+padding+traySlotSize/2,trayY=trayTop+padding+traySlotSize/2;
  const bounds=geometry(level),worldCenterX=(bounds.left+bounds.right)/2,worldCenterY=(bounds.top+bounds.bottom)/2;
  const centerX=360,centerY=(BOARD_TOP+BOARD_BOTTOM)/2;
  const fit=Math.min(680/(bounds.right-bounds.left+level.board.pitch+18),(BOARD_BOTTOM-BOARD_TOP-40)/(bounds.bottom-bounds.top+level.board.pitch+18));
  const raw=state.viewport||{},zoom=Number.isFinite(raw.zoom)?Math.max(.5,Math.min(level.maxZoom||3,raw.zoom)):1;
  const x=Number.isFinite(raw.x)?raw.x:0,y=Number.isFinite(raw.y)?raw.y:0,scale=fit*zoom;
  return {trayTop,trayBottom,trayLeft,trayWidth,trayHeight,trayX,trayY,traySlotSize,trayBeadSize,trayPitchX,trayPitchY,cols,rows,centerX,centerY,scale,zoom,x,y,
    expandX:trayLeft+trayWidth+expandGap,expandY:trayTop+(trayHeight-TRAY_EXPAND_HEIGHT)/2,expandWidth:TRAY_EXPAND_WIDTH,expandHeight:TRAY_EXPAND_HEIGHT,
    boardY:v=>centerY+(v-worldCenterY)*scale+y,boardX:v=>centerX+(v-worldCenterX)*scale+x,
    worldX:v=>worldCenterX+(v-centerX-x)/scale,worldY:v=>worldCenterY+(v-centerY-y)/scale};
}
export function inBoardArea(level,state,p){
  const l=layout(level,state);
  const overTray=p.x>=l.trayLeft&&p.x<=l.trayLeft+l.trayWidth&&p.y>=l.trayTop&&p.y<l.trayBottom;
  const overExpand=p.x>=l.expandX&&p.x<=l.expandX+l.expandWidth&&p.y>=l.expandY&&p.y<=l.expandY+l.expandHeight;
  return p.x>=0&&p.x<=720&&p.y>=BOARD_TOP&&p.y<BOARD_BOTTOM&&(state.status==='won'||(!overTray&&!overExpand));
}
function constrain(level,state){
  const l=layout(level,state),bounds=geometry(level);
  const pad=level.board.pitch*l.scale/2;
  const left=l.boardX(bounds.left)-pad,right=l.boardX(bounds.right)+pad;
  const top=l.boardY(bounds.top)-pad,bottom=l.boardY(bounds.bottom)+pad;
  let dx=right<80?80-right:left>640?640-left:0;
  let dy=bottom<BOARD_TOP+80?BOARD_TOP+80-bottom:top>BOARD_BOTTOM-80?BOARD_BOTTOM-80-top:0;
  // Irregular patterns may have empty bounding-box corners. Keep an actual bead reachable.
  if(dx||dy){
  const moved=bounds.cells.map(p=>({x:l.boardX(p.x)+dx,y:l.boardY(p.y)+dy}));
  if(!moved.some(p=>p.x>=20&&p.x<=700&&p.y>=BOARD_TOP+20&&p.y<=l.trayTop-20)){
    let closest=null,distance=Infinity;
    for(const p of moved){const x=Math.max(40,Math.min(680,p.x))-p.x,y=Math.max(BOARD_TOP+40,Math.min(l.trayTop-40,p.y))-p.y,d=x*x+y*y;if(d<distance){distance=d;closest={x,y};}}
    if(closest){dx+=closest.x;dy+=closest.y;}
  }
  }
  state.viewport={zoom:l.zoom,x:l.x+dx,y:l.y+dy};
}
export function panBoard(level,state,dx,dy){const l=layout(level,state);state.viewport={zoom:l.zoom,x:l.x+dx,y:l.y+dy};constrain(level,state);}
export function zoomBoard(level,state,factor,anchor,destination=anchor){
  const l=layout(level,state),zoom=Math.max(.5,Math.min(level.maxZoom||3,l.zoom*factor)),ratio=zoom/l.zoom;
  state.viewport={zoom,x:destination.x-l.centerX-(anchor.x-l.centerX-l.x)*ratio,y:destination.y-l.centerY-(anchor.y-l.centerY-l.y)*ratio};constrain(level,state);
}
export function resetBoard(state){delete state.viewport;}

// Delay bead taps until release so dragging or adding a second finger cannot move beads.
export function bindBoardGestures(canvas,{getContext,onTap,onChange,onEnd=()=>{}}){
  const pointers=new Map();let gesture=false;
  const context=()=>{const c=getContext();return c?.enabled?c:null;};
  const position=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*720/r.width,y:(e.clientY-r.top)*1280/r.height};};
  const pair=()=>{const [a,b]=[...pointers.values()].map(v=>v.p);return {center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};};
  const clear=()=>{const changed=gesture;pointers.clear();gesture=false;canvas.classList.remove('dragging');if(changed)onEnd();};
  canvas.addEventListener('pointerdown',e=>{
    const c=context();if(!c||e.button!==0||pointers.size>=2)return;
    const p=position(e);if(pointers.size&&(!inBoardArea(c.level,c.state,p)||![...pointers.values()].every(v=>v.canPan)))return;
    e.preventDefault();pointers.set(e.pointerId,{p,start:p,clientX:e.clientX,clientY:e.clientY,canPan:inBoardArea(c.level,c.state,p)});
    canvas.setPointerCapture?.(e.pointerId);if(pointers.size>1)gesture=true;
  });
  canvas.addEventListener('pointermove',e=>{
    const item=pointers.get(e.pointerId);if(!item)return;
    const c=context();if(!c){clear();return;}e.preventDefault();
    const p=position(e),old=item.p,before=pointers.size===2?pair():null;item.p=p;
    if(c.allowTransform===false){if(Math.hypot(e.clientX-item.clientX,e.clientY-item.clientY)>6)gesture=true;return;}
    if(before){const after=pair();zoomBoard(c.level,c.state,after.distance/before.distance,before.center,after.center);onChange();}
    else if(pointers.size===1&&item.canPan){
      if(!gesture&&Math.hypot(e.clientX-item.clientX,e.clientY-item.clientY)>6){gesture=true;panBoard(c.level,c.state,p.x-item.start.x,p.y-item.start.y);}
      else if(gesture)panBoard(c.level,c.state,p.x-old.x,p.y-old.y);
      if(gesture)onChange();
    }
    if(gesture)canvas.classList.add('dragging');
  });
  const finish=(e,cancelled)=>{
    const item=pointers.get(e.pointerId);if(!item)return;
    const c=context(),p=position(e),tap=!cancelled&&!gesture&&pointers.size===1&&Math.hypot(e.clientX-item.clientX,e.clientY-item.clientY)<=6;
    pointers.delete(e.pointerId);if(cancelled)gesture=true;
    if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    if(!pointers.size)clear();
    if(c&&tap)onTap(p);
  };
  canvas.addEventListener('pointerup',e=>finish(e,false));
  canvas.addEventListener('pointercancel',e=>finish(e,true));
  canvas.addEventListener('lostpointercapture',e=>{if(pointers.has(e.pointerId)){pointers.delete(e.pointerId);gesture=true;if(!pointers.size)clear();}});
  canvas.addEventListener('wheel',e=>{const c=context(),p=position(e);if(!c||c.allowTransform===false||!inBoardArea(c.level,c.state,p))return;e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?600:1);zoomBoard(c.level,c.state,Math.exp(-Math.max(-500,Math.min(500,delta))*.0015),p);onChange();},{passive:false});
  window.addEventListener('blur',clear);
  return clear;
}

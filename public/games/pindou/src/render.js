import {locked,targetAt} from './engine.js';
import {levels} from './levels.js';
import {layout,BOARD_TOP,BOARD_BOTTOM,inBoardArea,geometry} from './viewport.js';
import {drawSmoothGem} from './quality.js';
import {PORTRAIT_COLORS} from './portrait-colors.js';
export {layout} from './viewport.js';
export const COLORS={R:'#ff3c2e',G:'#38b723',Y:'#fac20a',M:'#8c3649',B:'#a64f16',W:'#f3f0e3',L:'#a6d321',C:'#36d9dc',D:'#159ccb',O:'#f68a13',P:'#efa6b6',A:'#f4be70',F:'#ffdda2',E:'#b7593e',H:'#71382e',T:'#277345',V:'#53633b',K:'#292830',U:'#7854b0',I:'#d2dfd3',N:'#b38a47'};
export {ASSET_NAMES,loadAssets} from './assets.js';
Object.assign(COLORS,PORTRAIT_COLORS);
export function point(level,state,zone,index,l=layout(level,state)){
  if(zone==='tray'){
    const row=Math.floor(index/l.cols),rowLength=Math.min(l.cols,state.tray.length-row*l.cols),offset=(l.cols-rowLength)*l.trayPitchX/2;
    return {x:l.trayX+offset+(index%l.cols)*l.trayPitchX,y:l.trayY+row*l.trayPitchY,size:l.trayBeadSize};
  }
  const w=level.target[0].length;
  return {x:l.boardX(level.board.x+(index%w)*level.board.pitch),y:l.boardY(level.board.y+Math.floor(index/w)*level.board.pitch),size:level.board.size*l.scale};
}
export function hitTest(level,state,x,y){
  const l=layout(level,state),w=level.target[0].length;
  const c=Math.round((l.worldX(x)-level.board.x)/level.board.pitch),r=Math.round((l.worldY(y)-level.board.y)/level.board.pitch);
  if(state.status!=='won'&&x>=l.trayLeft&&x<=l.trayLeft+l.trayWidth&&y>=l.trayTop&&y<l.trayBottom){
    const row=Math.max(0,Math.min(l.rows-1,Math.round((y-l.trayY)/l.trayPitchY))),rowLength=Math.min(l.cols,state.tray.length-row*l.cols),offset=(l.cols-rowLength)*l.trayPitchX/2;
    const col=l.trayPitchX?Math.max(0,Math.min(rowLength-1,Math.round((x-l.trayX-offset)/l.trayPitchX))):0,index=row*l.cols+col;
    if(index<state.tray.length)return {zone:'tray',index};
  }
  if(inBoardArea(level,state,{x,y})&&r>=0&&r<level.target.length&&c>=0&&c<w&&level.target[r][c]!=='.')return {zone:'board',index:r*w+c};
  return null;
}
export function clientPoint(rect,x,y){return {x:(x-rect.left)*720/rect.width,y:(y-rect.top)*1280/rect.height};}
function round(ctx,x,y,w,h,r,fill,stroke,width=1){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
const outlineCache=new WeakMap();
function outline(level){
  if(outlineCache.has(level))return outlineCache.get(level);
  const edges=[],grid=level.target,w=grid[0].length;
  const has=(x,y)=>x>=0&&x<w&&y>=0&&y<grid.length&&grid[y][x]!=='.';
  for(let y=0;y<grid.length;y++)for(let x=0;x<w;x++)if(has(x,y)){
    if(!has(x,y-1))edges.push([[x,y],[x+1,y]]);
    if(!has(x+1,y))edges.push([[x+1,y],[x+1,y+1]]);
    if(!has(x,y+1))edges.push([[x+1,y+1],[x,y+1]]);
    if(!has(x-1,y))edges.push([[x,y+1],[x,y]]);
  }
  const map=new Map();for(const edge of edges){const key=edge[0].join(',');if(!map.has(key))map.set(key,[]);map.get(key).push(edge);}
  const remaining=new Set(edges),loops=[];
  while(remaining.size){
    const first=remaining.values().next().value,points=[];let edge=first;
    do{
      remaining.delete(edge);points.push(edge[0]);const end=edge[1];if(end.join(',')===first[0].join(','))break;
      const choices=(map.get(end.join(','))||[]).filter(e=>remaining.has(e));
      // At diagonal corners keep each boundary on its own side of the touching point.
      const dx=end[0]-edge[0][0],dy=end[1]-edge[0][1];
      edge=choices.find(e=>dx*(e[1][1]-end[1])-dy*(e[1][0]-end[0])>0)||choices[0];
    }while(edge);
    loops.push(points.filter((p,i)=>{const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];return (p[0]-a[0])*(b[1]-p[1])!==(p[1]-a[1])*(b[0]-p[0]);}));
  }
  outlineCache.set(level,loops);return loops;
}
function boardPath(ctx,level,state,l){
  const b=level.board,radius=b.pitch*.33*l.scale;
  ctx.beginPath();
  for(const loop of outline(level)){
  const p=loop.map(([x,y])=>[l.boardX(b.x+(x-.5)*b.pitch),l.boardY(b.y+(y-.5)*b.pitch)]);
  for(let i=0;i<p.length;i++){
    const a=p[(i+p.length-1)%p.length],v=p[i],n=p[(i+1)%p.length],da=Math.hypot(v[0]-a[0],v[1]-a[1]),dn=Math.hypot(n[0]-v[0],n[1]-v[1]),r=Math.min(radius,da/2,dn/2);
    const before=[v[0]+(a[0]-v[0])*r/da,v[1]+(a[1]-v[1])*r/da],after=[v[0]+(n[0]-v[0])*r/dn,v[1]+(n[1]-v[1])*r/dn];
    if(i===0)ctx.moveTo(...before);else ctx.lineTo(...before);ctx.quadraticCurveTo(...v,...after);
  }ctx.closePath();}
}
function drawGem(ctx,assets,color,p,{selected=false,flat=false,alpha=1}={},gem=drawSmoothGem){
  ctx.save();ctx.globalAlpha=alpha;
  const lift=selected?p.size*.27:0;
  if(selected){ctx.fillStyle='#0003';ctx.beginPath();ctx.ellipse(p.x,p.y+p.size*.2,p.size*.4,p.size*.18,0,0,Math.PI*2);ctx.fill();}
  if(flat)ctx.globalAlpha*=.9;
  gem(ctx,color,p.x,p.y-lift,p.size);
  ctx.restore();
}
function drawTopPanel(ctx,x,y,w,h){
  ctx.save();ctx.shadowColor='#51486b1c';ctx.shadowBlur=12;ctx.shadowOffsetY=3;
  round(ctx,x,y,w,h,18,'#fcfbfff5');ctx.restore();
  round(ctx,x+.75,y+.75,w-1.5,h-1.5,17.25,null,'#dcd7ea',1.5);
}
function drawSettings(ctx){
  drawTopPanel(ctx,10,17,64,58);
  // Vector icons have no baked rectangular image background and stay sharp.
  ctx.save();ctx.translate(42,46);ctx.fillStyle='#8881ae';ctx.lineJoin='round';
  ctx.beginPath();
  for(let i=0;i<32;i++){
    const angle=i*Math.PI/16-Math.PI/16,r=[14,18,18,14][i%4];
    const x=Math.cos(angle)*r,y=Math.sin(angle)*r;
    if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);
  }
  ctx.closePath();ctx.moveTo(6,0);ctx.arc(0,0,6,0,Math.PI*2);
  ctx.fill('evenodd');ctx.restore();
}
function drawTimer(ctx,assets,state){
  drawTopPanel(ctx,506,17,190,58);
  ctx.save();ctx.translate(533,47);ctx.lineCap='round';ctx.lineJoin='round';
  round(ctx,-5,-23,10,5,2,'#b5915c');
  ctx.strokeStyle='#b5915c';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,-18);ctx.lineTo(0,-14);ctx.moveTo(10,-12);ctx.lineTo(13,-15);ctx.stroke();
  ctx.beginPath();ctx.arc(0,0,14,0,Math.PI*2);ctx.fillStyle='#fff7e9';ctx.fill();ctx.stroke();
  ctx.strokeStyle='#806c96';ctx.lineWidth=2.7;ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(0,0);ctx.lineTo(6,3);ctx.stroke();
  ctx.beginPath();ctx.arc(0,0,2,0,Math.PI*2);ctx.fillStyle='#806c96';ctx.fill();ctx.restore();
  ctx.save();ctx.font='bold 29px Arial';ctx.fillStyle='#565a8e';ctx.textAlign='center';
  const secs=Math.ceil(state.remaining);ctx.fillText(`${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`,619,56);ctx.restore();
}
function drawProgress(ctx,level,state){
  const cells=geometry(level).cells,correct=cells.reduce((count,cell)=>count+Number(state.board[cell.index]===cell.color),0);
  const ratio=cells.length?correct/cells.length:0,percent=cells.length?Math.floor(correct*100/cells.length):0;
  round(ctx,90,27,398,37,11,'#fff');
  round(ctx,94,31,390,29,8,'#efeff7');
  if(correct){
    const fill=ctx.createLinearGradient(0,31,0,60);fill.addColorStop(0,'#c4c1f1');fill.addColorStop(1,'#a4abdf');
    ctx.save();ctx.beginPath();ctx.roundRect(94,31,390,29,8);ctx.clip();ctx.fillStyle=fill;ctx.fillRect(94,31,390*ratio,29);ctx.restore();
  }
  ctx.font='bold 22px Arial, "Microsoft YaHei", sans-serif';ctx.textAlign='center';ctx.fillStyle='#4f537f';ctx.fillText(`进度 ${percent}%`,289,54);
}
function visible(p,l,pad=p.size){return p.x+pad>=0&&p.x-pad<=720&&p.y+pad>=BOARD_TOP&&p.y-pad<BOARD_BOTTOM;}
function drawWell(ctx,p,base=null){
  const x=p.x-p.size/2,y=p.y-p.size/2,r=p.size*.28;
  if(base)round(ctx,x,y,p.size,p.size,r,base);
  const well=ctx.createLinearGradient(0,y,0,y+p.size);well.addColorStop(0,'#0005');well.addColorStop(1,'#0001');
  round(ctx,x,y,p.size,p.size,r,well);
}
function drawStatic(ctx,assets,level,state,view,l,gem=drawSmoothGem){
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.clearRect(0,0,720,1280);ctx.drawImage(assets.background,0,0,720,1280);

  ctx.save();ctx.beginPath();ctx.rect(0,BOARD_TOP,720,BOARD_BOTTOM-BOARD_TOP);ctx.clip();
  boardPath(ctx,level,state,l);ctx.lineJoin='round';
  for(const [width,color] of [[9,'#9d9fb7'],[6,'#c9cadb'],[3,'#fafafc']]){ctx.lineWidth=width*l.scale;ctx.strokeStyle=color;ctx.stroke();}
  ctx.fillStyle='#efeee4';ctx.fill();
  ctx.save();
  ctx.clip();
  const cells=geometry(level).cells.map(cell=>({...cell,p:{x:l.boardX(cell.x),y:l.boardY(cell.y),size:level.board.size*l.scale}})).filter(cell=>visible(cell.p,l,level.board.pitch*l.scale));
  for(const {color,p} of cells){
    const pitch=level.board.pitch*l.scale;
    ctx.fillStyle=COLORS[color];ctx.fillRect(p.x-pitch/2-.2,p.y-pitch/2-.2,pitch+.4,pitch+.4);
  }
  for(const {p} of cells){
    drawWell(ctx,p);
  }ctx.restore();ctx.restore();

  const moving=new Set(view.flights?.map(f=>`${f.toZone}:${f.to}`)||[]);
  const selected=new Set(state.selection?.ids||[]);
  for(const zone of ['board'])for(let i=0;i<state[zone].length;i++){
    const color=state[zone][i];if(!color||moving.has(`${zone}:${i}`))continue;
    const p=point(level,state,zone,i,l);if(zone==='board'&&!visible(p,l))continue;
    ctx.save();ctx.beginPath();ctx.rect(0,BOARD_TOP,720,BOARD_BOTTOM-BOARD_TOP);ctx.clip();
    if(locked(level,state,i)){
      // Snap shared edges to screen pixels; draw each shared divider only once.
      const unit=view.pixelGap||1,pitch=level.board.pitch*l.scale;
      const left=Math.round((p.x-pitch/2)/unit)*unit,top=Math.round((p.y-pitch/2)/unit)*unit;
      const right=Math.round((p.x+pitch/2)/unit)*unit,bottom=Math.round((p.y+pitch/2)/unit)*unit;
      const border=unit*.5;
      ctx.fillStyle=COLORS[color];ctx.fillRect(left,top,right-left,bottom-top);
      ctx.fillStyle='rgba(0,0,0,.35)';
      ctx.fillRect(left,top,right-left,border);
      ctx.fillRect(left,top+border,border,Math.max(0,bottom-top-border));
    }else drawGem(ctx,assets,color,p,{selected:state.selection?.zone===zone&&selected.has(i)},gem);
    ctx.restore();
  }
}
function drawTrayUI(ctx,assets,level,state,view,l,gem){
  if(state.status!=='won'){
  ctx.save();ctx.shadowColor='#35314e30';ctx.shadowBlur=14;ctx.shadowOffsetY=3;
  round(ctx,l.trayLeft,l.trayTop,l.trayWidth,l.trayHeight,14,'#f8f8f8eb');ctx.restore();
  const moving=new Set(view.flights?.filter(f=>f.toZone==='tray').map(f=>f.to)||[]);
  const selected=new Set(state.selection?.zone==='tray'?state.selection.ids:[]);
  for(let i=0;i<state.tray.length;i++){
    const p=point(level,state,'tray',i,l);drawWell(ctx,{...p,size:l.traySlotSize},COLORS.W);
    if(state.tray[i]&&!moving.has(i))drawGem(ctx,assets,state.tray[i],p,{selected:selected.has(i)},gem);
  }
  }
}
function drawHud(ctx,assets,level,state){
  drawSettings(ctx);
  drawProgress(ctx,level,state);drawTimer(ctx,assets,state);
}
function drawDynamic(ctx,assets,level,state,view,t,l,gem=drawSmoothGem){
  // The tray is a destination surface. Draw it before flights so incoming
  // beads remain visible until they settle into their slots.
  drawTrayUI(ctx,assets,level,state,view,l,gem);
  for(const f of view.flights||[]){
    const progress=Math.min(1,Math.max(0,(t-f.start)/f.duration)),ease=1-(1-progress)**3,a=f.fromPoint,b=point(level,state,f.toZone,f.to,l);
    const p={x:a.x+(b.x-a.x)*ease,y:a.y+(b.y-a.y)*ease-Math.sin(progress*Math.PI)*70,size:a.size+(b.size-a.size)*ease};
    drawGem(ctx,assets,f.color,p,{flat:progress===1&&f.toZone==='board'},gem);
  }
  for(const s of view.sparkles||[]){
    const age=(t-s.start)/(s.duration??650);if(age<0||age>1)continue;
    const p=point(level,state,'board',s.index,l),rad=p.size*.6*Math.sin(age*Math.PI);if(!visible(p,l))continue;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(age);ctx.fillStyle=`rgba(255,255,255,${1-age})`;ctx.beginPath();for(let j=0;j<8;j++){const r=j%2?rad*.2:rad;ctx.lineTo(Math.cos(j*Math.PI/4)*r,Math.sin(j*Math.PI/4)*r);}ctx.closePath();ctx.fill();ctx.restore();
  }
  drawHud(ctx,assets,level,state);
  if(view.tutorial&&state.status==='playing')drawTutorial(ctx,assets,level,state,t,l);
}
export function render(ctx,assets,level,state,view,t){const l=layout(level,state);drawStatic(ctx,assets,level,state,view,l);drawDynamic(ctx,assets,level,state,view,t,l);}
export function createRenderer(ctx,{makeCanvas=(w,h)=>{
  if(typeof OffscreenCanvas!=='undefined')return new OffscreenCanvas(w,h);
  if(typeof document!=='undefined'){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
  return null;
},budget=48*1024*1024}={}){
  let scene=null,sceneContext=null,key=null,currentLevel=null,dirty=true,lastDynamic=false,lastSecond=null;
  const sprites=new Map(),stats={frames:0,sceneBuilds:0,timerOnly:0,spriteBuilds:0,bytes:0};
  function release(){if(scene){scene.width=scene.height=1;}for(const s of sprites.values())s.canvas.width=s.canvas.height=1;sprites.clear();scene=null;sceneContext=null;key=null;stats.bytes=0;dirty=true;lastDynamic=false;lastSecond=null;}
  function gem(target,color,x,y,size){
    const m=target.getTransform(),pixels=Math.ceil(size*Math.max(Math.abs(m.a),Math.abs(m.d))),required=Math.max(16,Math.ceil(pixels/16)*16);
    let sprite=sprites.get(color);
    if(!sprite||sprite.size<required){
      const bytes=(required+4)**2*4,previous=sprite?(sprite.size+4)**2*4:0;
      if(stats.bytes-previous+bytes<=budget){
        const image=makeCanvas(required+4,required+4);
        if(image){const c=image.getContext('2d');drawSmoothGem(c,color,2+required/2,2+required/2,required);if(sprite)sprite.canvas.width=sprite.canvas.height=1;sprite={canvas:image,size:required};sprites.set(color,sprite);stats.bytes+=bytes-previous;stats.spriteBuilds++;}
      }
    }
    if(sprite&&sprite.size>=pixels){const pad=2*size/sprite.size;target.drawImage(sprite.canvas,x-size/2-pad,y-size/2-pad,size+2*pad,size+2*pad);}
    else drawSmoothGem(target,color,x,y,size);
  }
  return {stats,invalidate(){dirty=true;},dispose(){release();currentLevel=null;},draw(assets,level,state,view,t){
    stats.frames++;
    const w=ctx.canvas.width,h=ctx.canvas.height;
    if(currentLevel!==level||scene&&(scene.width!==w||scene.height!==h)){release();currentLevel=level;}
    if(!scene&&w*h*4<=budget){scene=makeCanvas(w,h);if(scene){sceneContext=scene.getContext('2d');sceneContext.setTransform(w/720,0,0,h/1280,0,0);sceneContext.imageSmoothingEnabled=true;sceneContext.imageSmoothingQuality='high';stats.bytes+=w*h*4;}}
    const l=layout(level,state),selection=state.selection;
    const nextContent=[state.runId,state.tray.length,view.streak,state.board.map(c=>c||'_').join(''),state.tray.map(c=>c||'_').join(''),selection?.zone,selection?.ids.join(','),(view.flights||[]).map(f=>`${f.toZone}:${f.to}`).join(',')].join('|');
    const nextKey=[l.scale,l.x,l.y,view.pixelGap,state.status,nextContent].join('|');
    const changed=dirty||key!==nextKey,dynamic=!!(view.flights?.length||view.sparkles?.length||(view.tutorial&&state.status==='playing'&&state.tutorialStep<6));
    if(!scene){drawStatic(ctx,assets,level,state,view,l,gem);stats.sceneBuilds++;drawDynamic(ctx,assets,level,state,view,t,l,gem);return;}
    if(changed){
      drawStatic(sceneContext,assets,level,state,view,l,gem);
      stats.sceneBuilds++;key=nextKey;dirty=false;
    }
    if(changed||dynamic||lastDynamic){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(scene,0,0);ctx.restore();drawDynamic(ctx,assets,level,state,view,t,l,gem);}
    else if(lastSecond!==Math.ceil(state.remaining)){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(scene,0,0);ctx.restore();drawDynamic(ctx,assets,level,state,view,t,l,gem);stats.timerOnly++;}
    lastDynamic=dynamic;lastSecond=Math.ceil(state.remaining);
  }};
}
function drawTutorial(ctx,assets,level,state,t,l){
  const messages=['点击砖块选中它们','点击空白位置，将砖块移动过去','点击砖块选中它们','将砖块移动到对应颜色的格子','选择在暂存区中的砖块','将砖块移动到对应颜色的格子'];
  const step=state.tutorialStep;if(step>=messages.length)return;
  let p=step===0?point(level,state,'board',8,l):step===1||step===4?point(level,state,'tray',6,l):step===2?point(level,state,'board',21,l):step===3?point(level,state,'board',2,l):point(level,state,'board',21,l);
  const pulse=(Math.sin(t/270)+1)/2;
  ctx.save();const glow=ctx.createRadialGradient(p.x,p.y,4,p.x,p.y,52);glow.addColorStop(0,'#ffffff00');glow.addColorStop(.66,'#ffffff70');glow.addColorStop(1,'#ffffff00');ctx.fillStyle=glow;ctx.fillRect(p.x-55,p.y-55,110,110);ctx.globalAlpha=.92;ctx.strokeStyle='#fff';ctx.lineWidth=17;ctx.beginPath();ctx.arc(p.x,p.y,43+pulse*10,0,Math.PI*2);ctx.stroke();ctx.restore();ctx.save();ctx.translate(p.x+45,p.y+(p.y>l.trayTop?-35:8)+pulse*5);ctx.rotate(step===0?-.35:0);ctx.drawImage(assets.hand,-51,-65,102,114);ctx.restore();
  round(ctx,85,l.trayTop-100,550,64,17,'#fff','#c5c6cc',2);ctx.font='27px Arial, "Microsoft YaHei", sans-serif';ctx.textAlign='center';ctx.fillStyle='#565b91';ctx.fillText(messages[step],360,l.trayTop-58);
}

import {PORTRAIT_COLORS} from './portrait-colors.js';
// Facet colors sampled from the original recorded sprites: top, sides, bottom, rim.
export const GEM_PALETTES={
  I:['#eef4eb','#d2dfd3','#d2dfd3','#b4c5b7','#91a597','#b0c0b4'],
  N:['#d7b271','#b38a47','#b38a47','#947037','#735529','#a68146'],
  K:['#45434b','#292830','#292830','#1d1c24','#111018','#34313b'],
  U:['#a085dd','#7854b0','#7854b0','#5d3d90','#432968','#68508c'],
  A:['#ffda91','#f4be70','#f4be70','#d79d51','#b47b39','#c58d4b'],
  F:['#fff0c3','#ffdda2','#ffdda2','#e5bc7d','#bd955b','#d1ac73'],
  E:['#d57758','#b7593e','#b7593e','#96412d','#773123','#9a4834'],
  H:['#935347','#71382e','#71382e','#5a291f','#452019','#68352b'],
  T:['#3d9261','#277345','#277345','#1c5b33','#134527','#2c6240'],
  V:['#728153','#53633b','#53633b','#404f2c','#2e3c20','#4b5934'],
  B:['#a7521f','#8e3d14','#8e3d14','#76320e','#682d0e','#763911'],
  C:['#49fbfe','#44e8eb','#44e5e7','#36c1b4','#1f9285','#3f8077'],
  D:['#3dc2f1','#1b9cd5','#1a9ed6','#1483c3','#0769a1','#1a7c9c'],
  G:['#49ca39','#309e27','#309e27','#298c25','#1e751a','#359f2f'],
  L:['#c1e94b','#97c620','#94c521','#7db10d','#699712','#74871d'],
  M:['#994c56','#6b2834','#6b2834','#65202c','#561823','#320c11'],
  O:['#fda739','#ff7e14','#fe7f14','#dd5d00','#d25102','#d36a17'],
  P:['#feb7cd','#eaa7b5','#eaa7b5','#cc929e','#bf7b82','#e097a0'],
  R:['#fe4038','#e62318','#e62318','#d22015','#b3190f','#e2241a'],
  W:['#fefefe','#eee9de','#eee9de','#d2cdc2','#bab4ac','#ded9cc'],
  Y:['#fdd945','#f8c011','#f8c011','#e88e03','#c25a00','#983717'],
  slot:['#eeeeee','#d0d0d0','#d8d8d8','#bababa','#b0b0b0','#c8c8c8']
};
// Derive the same six facets for the portrait without changing older palettes.
for(const [key,hex] of Object.entries(PORTRAIT_COLORS)){
  const rgb=hex.slice(1).match(/../g).map(c=>parseInt(c,16));
  const shade=(factor,lift=0)=>'#'+rgb.map(c=>Math.max(0,Math.min(255,Math.round(c*factor+lift))).toString(16).padStart(2,'0')).join('');
  GEM_PALETTES[key]=[shade(1,15),hex,hex,shade(.84),shade(.65),shade(.78)];
}
export function canvasResolution(displayScale,dpr=1){
  // 1.5× supersampling, bounded to about 8.3 million pixels at the largest size.
  const ratio=Math.max(1.5,Math.min(3,displayScale*dpr*1.5));
  return {width:Math.round(720*ratio),height:Math.round(1280*ratio)};
}
export function drawSmoothGem(ctx,color,x,y,size){
  const colors=GEM_PALETTES[color];ctx.save();ctx.translate(x-size/2,y-size/2);ctx.scale(size,size);
  ctx.beginPath();ctx.roundRect(.015,.02,.97,.97,.28);ctx.fillStyle=colors[5];ctx.fill();
  ctx.beginPath();ctx.roundRect(.055,.045,.89,.895,.245);ctx.fillStyle=colors[4];ctx.fill();
  ctx.save();ctx.beginPath();ctx.roundRect(.075,.065,.85,.805,.23);ctx.clip();
  // Paint an opaque base under the facets to avoid antialiasing seams at shared edges.
  ctx.fillStyle=colors[1];ctx.fillRect(0,0,1,1);
  const triangles=[[[0,0],[1,0],[.5,.47]],[[0,0],[.5,.47],[0,1]],[[1,0],[1,1],[.5,.47]],[[0,1],[.5,.47],[1,1]]];
  triangles.forEach((points,i)=>{ctx.beginPath();ctx.moveTo(...points[0]);ctx.lineTo(...points[1]);ctx.lineTo(...points[2]);ctx.closePath();ctx.fillStyle=colors[i];ctx.fill();});
  ctx.restore();ctx.restore();
}

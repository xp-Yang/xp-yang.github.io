// Color priority is fixed by the complete chart, not by the changing tray or
// remaining groups. Equal counts follow the first target cell in reading order.
const orders=new WeakMap();
export function autoColorOrder(level){
  if(!orders.has(level)){
    const colors=new Map();let index=0;
    for(const row of level.target)for(const color of row){
      if(color!=='.'){
        if(!colors.has(color))colors.set(color,{color,count:0,first:index});
        colors.get(color).count++;
      }
      index++;
    }
    orders.set(level,Object.freeze([...colors.values()].sort((a,b)=>a.count-b.count||a.first-b.first).map(Object.freeze)));
  }
  return orders.get(level);
}

export function currentAutoColor(level,state){
  const remaining=new Map();let index=0;
  for(const row of level.target)for(const color of row){
    if(color!=='.'&&state.board[index]!==color)remaining.set(color,(remaining.get(color)||0)+1);
    index++;
  }
  const next=autoColorOrder(level).find(entry=>remaining.has(entry.color));
  return next?{...next,remaining:remaining.get(next.color)}:null;
}

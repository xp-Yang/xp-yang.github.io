// Keep the logical 720×1280 game inside Safari's visible, unobscured area.
export function fitMobileViewport(width,height,insets={}){
  const left=Math.max(0,insets.left||0),right=Math.max(0,insets.right||0),top=Math.max(0,insets.top||0),bottom=Math.max(0,insets.bottom||0);
  const availableWidth=Math.max(1,width-left-right),availableHeight=Math.max(1,height-top-bottom);
  return {width:availableWidth,height:availableHeight,scale:Math.min(availableWidth/720,availableHeight/1280)};
}

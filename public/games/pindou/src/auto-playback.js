// A foreground-time budget, including initial planning. Small levels keep their
// exact original timings. Logical transfers stay serial at every playback rate.
export function createAutoPlayback(levelId,start,{targetMs=110000}={}){
  let elapsed=0,last=start,active=true,average=3,frames=16.7,previousFrame=null;
  return {
    sample(now,enabled=true){if(active)elapsed+=Math.max(0,now-last);last=now;active=enabled;},
    frame(now){if(previousFrame!==null){const dt=now-previousFrame;if(dt>0&&dt<150)frames=frames*.9+dt*.1;}previousFrame=now;},
    moved(units){average=.9*average+.1*Math.max(1,units);},
    timing({queued=0,complete=false,units=0,regions=0}={}){
      if(levelId!==9)return {selection:220,flight:330,stagger:1,scale:1};
      const batches=complete?Math.max(1,queued):Math.max(1,queued,Math.ceil(units/average),Math.ceil(regions*1.6));
      const budget=Math.max(1,(targetMs-elapsed)/batches);
      // Reserve a frame for landing, and avoid an extra frame for selecting at
      // high speeds. Keep flight and stagger proportional to the old animation.
      const scale=Math.min(1,Math.max(.002,(budget-frames*1.2)/790));
      return {selection:scale<.2?0:220*scale,flight:330*scale,stagger:scale,scale,
        perFrame:Math.max(1,Math.min(8,Math.ceil(frames*1.2/budget)))};
    },
    get elapsed(){return elapsed;}
  };
}

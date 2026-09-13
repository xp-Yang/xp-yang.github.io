import {levels} from './levels.js';
export const ASSET_GROUPS={
  home:['settings','energy','coin','close','start-button','free',...levels.map(l=>'pattern-'+l.id)],
  game:['background','settings','trophy','clock','hand'],
  settlement:['win-title','rewards','double-button','pig','entry-dialog'],
  loading:['load']
};
export const ASSET_NAMES=[...new Set(Object.values(ASSET_GROUPS).flat())];
export function createAssetLoader(makeImage=()=>new Image()){
  const pending=new Map(),loaded={};
  function load(names=ASSET_NAMES){
    if(typeof names==='string')names=ASSET_GROUPS[names];
    return Promise.all(names.map(name=>{
      if(pending.has(name))return pending.get(name);
      // Defer setup to keep synchronous image decoders and asynchronous browsers identical.
      const request=Promise.resolve().then(()=>new Promise((resolve,reject)=>{
        const image=makeImage();image.onload=()=>{loaded[name]=image;resolve(image);};image.onerror=()=>reject(Error(`素材加载失败：${name}`));image.src=`assets/${name}.png`;
      })).catch(error=>{pending.delete(name);throw error;});
      pending.set(name,request);return request;
    })).then(()=>loaded);
  }
  return {load,loaded,ready:group=>ASSET_GROUPS[group].every(name=>loaded[name])};
}
export const assetLoader=createAssetLoader();
export const loadAssets=assetLoader.load;

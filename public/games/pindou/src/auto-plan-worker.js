import {streamAutoPlans} from './refill-auto.js';
let version=0;
self.onmessage=async({data:{level,state,cancel,budgetMs}})=>{
  const token=++version;if(cancel)return;
  try{await streamAutoPlans(level,state,{budgetMs,cancelled:()=>token!==version},message=>{if(token===version)self.postMessage(message);});}
  catch{if(token===version)self.postMessage({error:'自动方案规划失败'});}
};

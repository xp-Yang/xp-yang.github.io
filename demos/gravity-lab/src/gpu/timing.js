/** Optional, low-frequency timestamps. Mapping never gates the render queue. */
export function createGpuTiming(device) {
  if(!device.features.has('timestamp-query'))return null;
  const queries=device.createQuerySet({type:'timestamp',count:4});
  const resolved=device.createBuffer({size:32,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
  const readback=device.createBuffer({size:32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  let busy=false,disposed=false;
  return {
    begin() {
      if(busy||disposed)return null;
      busy=true;
      return {
        physics:{querySet:queries,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1},
        render:{querySet:queries,beginningOfPassWriteIndex:2,endOfPassWriteIndex:3},
        resolve(encoder) {
          encoder.resolveQuerySet(queries,0,4,resolved,0);
          encoder.copyBufferToBuffer(resolved,0,readback,0,32);
        },
        async read() {
          try {
            await readback.mapAsync(GPUMapMode.READ);
            const values=new BigUint64Array(readback.getMappedRange());
            return {physicsMs:Number(values[1]-values[0])/1e6,renderMs:Number(values[3]-values[2])/1e6};
          } finally {readback.unmap();busy=false;}
        },
        cancel(){busy=false;},
      };
    },
    dispose(){
      disposed=true;
      void device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>{queries.destroy();resolved.destroy();readback.destroy();});
    },
  };
}

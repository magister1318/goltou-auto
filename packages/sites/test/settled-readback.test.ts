import { expect, it, vi } from 'vitest';
import { settledReadback } from '../src/settled-readback';

it('waits beyond two identical incomplete snapshots and compares only two consecutive complete snapshots',async()=>{
  let time=0;const seen:number[]=[];
  const result=await settledReadback({now:()=>time,pause:async ms=>{time+=ms;},intervalMs:1000,timeoutMs:10000,check(){},
    read:async()=>{const count=time<3000?0:time<5000?1:2;seen.push(count);return{count};},
    classes:v=>[{check:'photos',reason:'READBACK_PHOTOS',expected:2,observed:v?.count??0,present:v?.count===2}],
  });
  expect(seen).toEqual([0,0,0,1,1,2,2]);expect(result).toMatchObject({value:{count:2},stable:true});
});
it('returns the final live snapshot at timeout without treating count equality as content equality',async()=>{
  let time=0;const compare=vi.fn();
  const result=await settledReadback({now:()=>time,pause:async ms=>{time+=ms;},intervalMs:500,timeoutMs:1500,check(){},read:async()=>({missing:true}),classes:()=>[{check:'hashtags',reason:'READBACK_TAGS',expected:2,observed:0,present:false}]});
  compare(result.value);expect(time).toBe(1500);expect(result.stable).toBe(true);expect(result.classes[0]!.present).toBe(false);expect(compare).toHaveBeenCalledTimes(1);
});
it('propagates cancellation and read failures without retrying an input',async()=>{
  await expect(settledReadback({check(){throw Error('STOPPED');},read:async()=>({}),classes:()=>[],timeoutMs:1000})).rejects.toThrow('STOPPED');
  await expect(settledReadback({check(){},read:async()=>{throw Error('READ_FAILED');},classes:()=>[],timeoutMs:1000})).rejects.toThrow('READ_FAILED');
});

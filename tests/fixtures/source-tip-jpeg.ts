import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {sourceWindows} from './source-tip-oracle';

export const sourceFixture={
 path:'tests/fixtures/character-front-back.jpg',
 sha256:'ce2cad952e7efc4228ed236736b1d5370803aa5616b251a4bbffa164cd4ea768',
 width:1275,height:750,
 coordinateConvention:'full original JPEG; integer pixel indexes, sample centers at coordinate + .5',
 windows:sourceWindows.flatMap(cap=>cap.windows.map(window=>({name:cap.name,axis:window.axis,stationStart:window.stations[0],stationEnd:window.stations[1],rangeStart:window.range[0],rangeEnd:window.range[1],left:window.axis==='x'?window.range[0]:window.stations[0],top:window.axis==='x'?window.stations[0]:window.range[0],right:window.axis==='x'?window.range[1]:window.stations[1],bottom:window.axis==='x'?window.stations[1]:window.range[1]})))
} as const;

let decoded:Promise<{rgba:Uint8Array;width:number;height:number}>|undefined;
export function loadSourceFixture(){return decoded??=(async()=>{
 const jpeg=await readFile(sourceFixture.path);
 if(createHash('sha256').update(jpeg).digest('hex')!==sourceFixture.sha256)throw Error('SOURCE_FIXTURE_SHA');
 for(const w of sourceFixture.windows)if(w.left<0||w.top<0||w.right>=sourceFixture.width||w.bottom>=sourceFixture.height||w.left>w.right||w.top>w.bottom)throw Error('SOURCE_WINDOW_BOUNDS');
 const {data,info}=await sharp(jpeg).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width!==sourceFixture.width||info.height!==sourceFixture.height||info.channels!==4)throw Error('SOURCE_FIXTURE_DIMENSIONS');
 return {rgba:new Uint8Array(data),width:info.width,height:info.height};
})();}

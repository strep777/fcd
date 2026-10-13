import {it,expect} from 'vitest';
import sharp from 'sharp';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';

it('full native illustration entry separates horns/forehead/ear fur while preserving pads and yellow shadow continuity',async()=>{
 const width=666,height=750,rgba=new Uint8Array(await sharp('tests/fixtures/character-front-back.jpg').extract({left:609,top:0,width,height}).ensureAlpha().raw().toBuffer()),result=illustrationRegions(width,height,rgba);
 const owner=(x:number,y:number)=>result.regions.findIndex(r=>r.indices.includes(y*width+x));
 const familyAt=(x:number,y:number)=>{const id=owner(x,y);expect(id).toBeGreaterThanOrEqual(0);return pigmentFamily(result.regions[id].color);};
 // These independently inspected original pixels must belong to five separate
 // structures through the actual production entry, not only the helper.
 const structures=[[178,55],[188,80],[218,140],[249,90],[265,125]];
 for(const [x,y]of structures)expect(familyAt(x,y)).toBe(2);
 expect(new Set(structures.map(([x,y])=>owner(x,y))).size).toBe(5);
 expect(owner(265,125)).toBe(owner(269,137));
 for(const [x,y]of [[316,70],[155,72],[45,243],[70,244],[28,264],[63,272],[87,265],[37,291]])expect(familyAt(x,y),`real inner ear/pad ${x},${y}`).toBe(1);
 for(const [x,y]of [[169,540],[355,564],[359,562],[311,565],[327,573]])expect(familyAt(x,y),`cast shadow ${x},${y}`).not.toBe(1);
 const tail=[[541,440],[500,473],[530,415]],thigh=[[348,547],[350,556],[352,566],[331,573],[356,575]];
 for(const points of [tail,thigh]){for(const [x,y]of points)expect(familyAt(x,y)).toBe(2);expect(new Set(points.map(([x,y])=>owner(x,y))).size).toBe(1);}
 const all=result.regions.flatMap(r=>r.indices);expect(new Set(all).size).toBe(all.length);expect(all.length).toBe(result.foregroundPixels-result.discardedPixels);
});
it('full back-view entry retains separate yellow ear markings and genuine pads without fragmenting tail pigment',async()=>{
 const width=609,height=750,rgba=new Uint8Array(await sharp('tests/fixtures/character-front-back.jpg').extract({left:0,top:0,width,height}).ensureAlpha().raw().toBuffer()),result=illustrationRegions(width,height,rgba),yellow=result.regions.filter(r=>pigmentFamily(r.color)===2);
 // Eight visible yellow components survive image-supported border changes.
 // Verify complete connected material instances, independent interior probes
 // and the neighboring white tail fur rather than obsolete pixel-count hashes.
 expect(yellow).toHaveLength(8);
 for(const region of yellow){const remaining=new Set(region.indices),queue=[region.indices[0]];remaining.delete(queue[0]);for(let k=0;k<queue.length;k++){const i=queue[k],x=i%width;for(const n of[x?i-1:-1,x+1<width?i+1:-1,i-width,i+width])if(remaining.delete(n))queue.push(n);}expect(remaining.size).toBe(0);}
 const owner=(x:number,y:number)=>result.regions.findIndex(r=>r.indices.includes(y*width+x)),ears=[[318,119],[418,80],[455,80]].map(([x,y])=>owner(x,y));
 for(const id of ears){expect(id).toBeGreaterThanOrEqual(0);expect(pigmentFamily(result.regions[id].color)).toBe(2);}expect(new Set(ears).size).toBe(3);
 const tail=[[55,450],[115,435],[70,510]].map(([x,y])=>owner(x,y));for(const id of tail){expect(id).toBeGreaterThanOrEqual(0);expect(pigmentFamily(result.regions[id].color)).toBe(2);}expect(new Set(tail).size).toBe(1);const white=owner(100,555);expect(white).toBeGreaterThanOrEqual(0);expect(pigmentFamily(result.regions[white].color)).toBe(0);expect(tail).not.toContain(white);
 const all=result.regions.flatMap(r=>r.indices);expect(new Set(all).size).toBe(all.length);expect(all.length).toBe(result.foregroundPixels-result.discardedPixels);
 const pad=owner(229,413);expect(pad).toBeGreaterThanOrEqual(0);expect(pigmentFamily(result.regions[pad].color)).toBe(1);
});

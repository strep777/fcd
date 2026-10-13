import {it,expect} from 'vitest';
import sharp from 'sharp';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';

it('rechecks pigment evidence after yellow shadow recovery so white-fur fringes do not remain pink fabric',async()=>{
 const width=666,height=750,rgba=new Uint8Array(await sharp('tests/fixtures/character-front-back.jpg').extract({left:609,top:0,width,height}).ensureAlpha().raw().toBuffer());
 const result=illustrationRegions(width,height,rgba),pinks=result.regions.filter(r=>pigmentFamily(r.color)===1);
 // Native-image pixels independently inspected in the white fur below yellow
 // thigh markings. The former pipeline left three pink islands (477 pixels)
 // because their supporting warm yellow pixels were reassigned afterwards.
 for(const [x,y] of [[169,540],[355,564],[359,562],[311,565],[327,573]])expect(pinks.some(r=>r.indices.includes(y*width+x)),`white-fur cast shadow ${x},${y}`).toBe(false);
 expect(pinks).toHaveLength(8); // Two inner ears plus six visible pink pads.
 for(const [x,y] of [[316,70],[155,72],[45,243],[70,244],[28,264],[63,272],[87,265],[37,291]])expect(pinks.some(r=>r.indices.includes(y*width+x)),`real pink material ${x},${y}`).toBe(true);
 const owned=result.regions.flatMap(r=>r.indices);expect(new Set(owned).size).toBe(owned.length);expect(owned.length).toBe(result.foregroundPixels-result.discardedPixels);
});

it('retains genuinely dark pink pigment rather than requiring bright material samples',()=>{
 const width=80,height=70,rgba=new Uint8Array(width*height*4).fill(255);
 for(let y=10;y<60;y++)for(let x=10;x<70;x++)rgba.set([110,60,75,255],(y*width+x)*4);
 const regions=illustrationRegions(width,height,rgba,true,'head').regions;
 expect(regions.filter(r=>pigmentFamily(r.color)===1)).toHaveLength(1);
 expect(regions.find(r=>pigmentFamily(r.color)===1)?.indices.length).toBe(3000);
});

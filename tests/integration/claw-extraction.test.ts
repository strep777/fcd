import {it,expect} from 'vitest';
import sharp from 'sharp';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';

it('retains the entire solid dark pigment of the original front foot claws',async()=>{
 const width=666,height=750,rgba=new Uint8Array(await sharp('tests/fixtures/character-front-back.jpg').extract({left:609,top:0,width,height}).ensureAlpha().raw().toBuffer());
 const result=illustrationRegions(width,height,rgba),dark=new Set(result.regions.filter(r=>pigmentFamily(r.color)===6).flatMap(r=>r.indices));
 // Hand-inspected filled claws, excluding thin fur outlines and toe creases.
 const boxes=[[70,643,77,666],[93,670,106,697],[112,668,126,704],[163,674,175,704],[344,710,355,736],[400,710,413,736],[418,705,432,735],[437,678,445,706]];
 for(const [x0,y0,x1,y1] of boxes){let total=0,retained=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=y*width+x;if(Math.max(...rgba.subarray(i*4,i*4+3))>=32)continue;total++;if(dark.has(i))retained++;}expect(total,JSON.stringify([x0,y0,x1,y1])).toBeGreaterThan(10);expect(retained/total,JSON.stringify([x0,y0,x1,y1])).toBeGreaterThan(.97);}
});

it('retains narrow almost-black claws without promoting thin outlines or creases',()=>{
 const width=80,height=80,rgba=new Uint8Array(width*height*4).fill(255);
 for(let y=10;y<70;y++)for(let x=10;x<70;x++)rgba.set(x<12||x>67||y<12||y>67||x===40&&y<55?[3,0,2,255]:[0,150,220,255],(y*width+x)*4);
 for(let y=40;y<65;y++)for(let x=20;x<27;x++)rgba.set([3,0,2,255],(y*width+x)*4);
 const result=illustrationRegions(width,height,rgba,true,'paw'),dark=result.regions.filter(r=>pigmentFamily(r.color)===6);
 expect(dark).toHaveLength(1);expect(dark[0].indices).toContain(43*width+23);expect(dark[0].indices).not.toContain(10*width+30);expect(dark[0].indices).not.toContain(25*width+40);
});


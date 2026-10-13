import {it,expect} from 'vitest';
import sharp from 'sharp';
import {recoverBluePigments} from '../../packages/reference/blue-pigments';
import {illustrationRegions} from '../../packages/reference/illustration';

it('navy recovery cannot change the foreground or unsupported white, pink, green and black labels',()=>{
 const width=100,height=100,foreground=new Uint8Array(width*height).fill(1),labels=new Int8Array(width*height).fill(4),saturation=new Float32Array(width*height).fill(.55),value=new Float32Array(width*height).fill(.9);
 for(let y=20;y<80;y++)for(let x=25;x<75;x++){value[y*width+x]=.3;saturation[y*width+x]=.95;}
 for(let y=40;y<50;y++)for(let x=35;x<45;x++){const i=y*width+x;labels[i]=[0,1,3,6][(x-35)%4];}
 const before=foreground.slice(),original=labels.slice(),recovered=recoverBluePigments(width,height,foreground,labels,saturation,value);
 expect(recovered).toBeGreaterThan(0);expect(foreground).toEqual(before);expect(recovered).toBe(labels.reduce((n,v,i)=>n+(v!==original[i]?1:0),0));
 for(let i=0;i<labels.length;i++)if(original[i]!==4)expect(labels[i]).toBe(original[i]);
});
it('a moderate blue shadow and saturated pixels outside the foreground never create navy',()=>{
 const width=100,height=100,foreground=new Uint8Array(width*height).fill(1),labels=new Int8Array(width*height).fill(4),saturation=new Float32Array(width*height).fill(.8),value=new Float32Array(width*height).fill(.9);
 for(let y=20;y<80;y++)for(let x=25;x<75;x++)value[y*width+x]=.6;
 expect(recoverBluePigments(width,height,foreground,labels,saturation,value)).toBe(0);
 for(let y=20;y<80;y++)for(let x=25;x<75;x++){const i=y*width+x;foreground[i]=0;value[i]=.3;}
 const before=labels.slice();expect(recoverBluePigments(width,height,foreground,labels,saturation,value)).toBe(0);expect(labels).toEqual(before);
});
it('mirroring the real character retains navy and both shoulder/hip candidates without relying on fixture coordinates',async()=>{
 const width=803,height=1024,rgba=new Uint8Array(await sharp('tests/fixtures/character-blue-white-front-back.png').extract({left:0,top:0,width,height}).ensureAlpha().raw().toBuffer()),before=rgba.slice(),original=illustrationRegions(width,height,rgba),mirrored=new Uint8Array(rgba.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)mirrored.set(rgba.subarray((y*width+x)*4,(y*width+x)*4+4),(y*width+width-1-x)*4);
 const r=illustrationRegions(width,height,mirrored),owner=(x:number,y:number)=>r.regions.find(s=>s.indices.includes(y*width+width-1-x))!;
 expect(rgba).toEqual(before);expect(r.foregroundPixels).toBe(original.foregroundPixels);const all=r.regions.flatMap(s=>s.indices);expect(new Set(all).size).toBe(all.length);expect(all.length).toBe(r.foregroundPixels-r.discardedPixels);
 for(const [x,y,side]of[[345,330,'right'],[510,330,'left']]as const)expect(owner(x,y).contexts?.map(c=>c.part+':'+c.side).sort()).toEqual(['arm:'+side,'body:center']);
 for(const [x,y,side]of[[367,455,'right'],[486,455,'left']]as const)expect(owner(x,y).contexts?.map(c=>c.part+':'+c.side).sort()).toEqual(['body:center','leg:'+side]);
 for(const [x,y]of[[332,603],[521,603]]){const navy=owner(x,y),brightness=Math.max(...[1,3,5].map(i=>parseInt(navy.color.slice(i,i+2),16)))/255;expect(brightness).toBeLessThan(.55);expect(navy.indices.length).toBeGreaterThan(1400);}
 expect(owner(423,321).contexts?.map(c=>c.part).sort()).toEqual(['body','head']);
});

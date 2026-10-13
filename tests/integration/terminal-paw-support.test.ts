import {it,expect,vi} from 'vitest';
import sharp from 'sharp';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
import {terminalPawSupport} from '../../packages/reference/terminal-paw-support';
import * as pawSupport from '../../packages/reference/terminal-paw-support';
import {createHash} from 'node:crypto';
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

it.each([['front',609,666,390,435,410,451,378,455],['back',0,609,560,265,586,244,600,269]] as const)('recovers the actual %s missing neutral hand and separate claws without swallowing its cuff',async(view,left,width,x,y,cx,cy,dx,dy)=>{
 const rgba=new Uint8Array(await sharp('tests/fixtures/character-front-back.jpg').extract({left,top:0,width,height:750}).ensureAlpha().raw().toBuffer()),r=illustrationRegions(width,750,rgba),owner=(x:number,y:number)=>r.regions.find(p=>p.indices.includes(y*width+x))!;
 expect(owner(x,y).part).toBe('paw');expect(owner(x,y).side).toBe('right');
 expect(owner(cx,cy).part).toBe('paw');expect(owner(dx,dy).part).toBe('paw');
 const cuff=view==='front'?owner(390,384):owner(551,307);expect(cuff.part).toBe('arm');expect(cuff.side).toBe('right');
 const frame=r.partBounds.find(p=>p.part==='paw'&&p.side==='right')!;expect(frame).toBeDefined();expect(frame.minX).toBeLessThanOrEqual(x);expect(frame.maxX).toBeGreaterThan(x);expect(frame.minY).toBeLessThanOrEqual(y);expect(frame.maxY).toBeGreaterThan(y);
 const all=r.regions.flatMap(p=>p.indices);expect(new Set(all).size).toBe(all.length);expect(all.length).toBe(r.foregroundPixels-r.discardedPixels);
});

function supportedHand(){
 const width=260,height=360,span=340,saturation=new Float32Array(width*height),value=new Float32Array(width*height),rect=(left:number,top:number,right:number,bottom:number,v:number)=>{const indices:number[]=[];for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const i=y*width+x;indices.push(i);saturation[i]=.1;value[i]=v;}return indices;},region=(indices:number[])=>({part:'arm' as const,side:'right' as const,confidence:.6,indices}),regions=[region(rect(185,100,215,135,.85)),region(rect(192,92,199,101,.05)),region(rect(216,110,223,119,.05))],arm:number[]=[];
 for(let y=125;y<185;y++)for(let x=165+185-y-10;x<165+185-y+10;x++)arm.push(y*width+x);
 return {width,span,top:0,head:{minX:80,minY:20,maxX:150,maxY:90},regions,saturation,value,arms:new Map<'left'|'right',number[]>([['right',arm]]),existing:new Set<'left'|'right'>()};
}
it('requires an independently supported distal neutral hand and two spatially separate compatible claw tips, without mutating material inputs',()=>{
 const input=supportedHand(),before=structuredClone(input.regions);expect(terminalPawSupport(input).map(h=>h.regionIndices)).toEqual([[0,1,2]]);expect(input.regions).toEqual(before);
 expect(terminalPawSupport({...input,regions:input.regions.slice(0,2)})).toEqual([]);
 expect(terminalPawSupport({...input,regions:input.regions.slice(1)})).toEqual([]);
 expect(terminalPawSupport({...input,existing:new Set(['right'])})).toEqual([]);
});
it.each(['head','tail','unknown','other-side'] as const)('does not infer a hand from nearby %s dark components',kind=>{
 const input=supportedHand(),regions=input.regions.map((r,i)=>i?{...r,part:kind==='other-side'?'arm' as const:kind,side:kind==='other-side'?'left' as const:r.side}:r);expect(terminalPawSupport({...input,regions})).toEqual([]);
});
it.each([['head',-70,-65],['tail',0,145]] as const)('rejects a neutral and two-tip cluster near the %s instead of borrowing an arm PCA frame',(_,dx,dy)=>{
 const input=supportedHand(),regions=input.regions.map(r=>({...r,indices:r.indices.map(i=>i+dy*input.width+dx)})),saturation=new Float32Array(input.saturation.length),value=new Float32Array(input.value.length);input.regions.forEach((r,j)=>r.indices.forEach((i,k)=>{const target=regions[j].indices[k];saturation[target]=input.saturation[i];value[target]=input.value[i];}));expect(terminalPawSupport({...input,regions,saturation,value})).toEqual([]);
});

// Total instance counts and whole-image metadata hashes change when an
// unsupported division is removed. Assert metadata nonmutation at the helper
// seam, and retain independently visible material/part anchors and frames.
it.each([['jpeg','character-front-back.jpg',[['front',609,666],['back',0,609]],750],['blueWhite','character-blue-white-front-back.png',[['front',0,803],['back',803,733]],1024]] as const)('%s terminal-hand metadata evidence never mutates real material inputs',async(name,file,crops,height)=>{
 const original=terminalPawSupport;let calls=0;
 const spy=vi.spyOn(pawSupport,'terminalPawSupport').mockImplementation(input=>{
  calls++;const regions=sha(input.regions),arms=sha([...input.arms]),existing=[...input.existing],saturation=input.saturation.slice(),value=input.value.slice(),head={...input.head};
  const result=original(input);
  expect(sha(input.regions)).toBe(regions);expect(sha([...input.arms])).toBe(arms);expect([...input.existing]).toEqual(existing);expect(input.head).toEqual(head);
  expect(Buffer.from(input.saturation.buffer,input.saturation.byteOffset,input.saturation.byteLength).equals(Buffer.from(saturation.buffer))).toBe(true);
  expect(Buffer.from(input.value.buffer,input.value.byteOffset,input.value.byteLength).equals(Buffer.from(value.buffer))).toBe(true);
  for(const hand of result){expect(new Set(hand.regionIndices).size).toBe(hand.regionIndices.length);expect(hand.regionIndices.length).toBeGreaterThanOrEqual(3);for(const i of hand.regionIndices){expect(i).toBeGreaterThanOrEqual(0);expect(i).toBeLessThan(input.regions.length);expect(input.regions[i].side).toBe(hand.side);expect(['arm','paw']).toContain(input.regions[i].part);}}
  return result;
 });
 try{for(const[view,left,width]of crops){
  const rgba=new Uint8Array(await sharp('tests/fixtures/'+file).extract({left,top:0,width,height}).ensureAlpha().raw().toBuffer()),imageBefore=rgba.slice(),r=illustrationRegions(width,height,rgba);
  expect(Buffer.from(rgba).equals(Buffer.from(imageBefore))).toBe(true);
  const all=r.regions.flatMap(p=>p.indices);expect(new Set(all).size).toBe(all.length);expect(all.length).toBe(r.foregroundPixels-r.discardedPixels);
  // Source-supported dark claws remain separate regions. The metadata helper
  // cannot consume their pixels or borrow the adjacent colored cuff.
  const dark=r.regions.filter(p=>pigmentFamily(p.color)===6);expect(dark.length).toBeGreaterThan(2);expect(dark.some(p=>p.part==='paw'||p.part==='foot')).toBe(true);
  if(name==='blueWhite'){
   const owner=(x:number,y:number)=>r.regions.find(p=>p.indices.includes(y*width+x))!,anchors=view==='front'?[[280,560,'paw','left',6],[270,555,'paw','left',1]]as const:[[75,560,'paw','left',6],[440,560,'paw','right',6],[178,925,'foot','left',4],[320,925,'foot','right',4]]as const;
   for(const[x,y,part,side,family]of anchors){const material=owner(x,y);expect(material).toBeDefined();expect(material.part).toBe(part);expect(material.side).toBe(side);expect(pigmentFamily(material.color)).toBe(family);
    const rgb=rgba.subarray((y*width+x)*4,(y*width+x)*4+3);if(family===6)expect(Math.max(...rgb)).toBeLessThan(80);if(family===1)expect(rgb[0]-rgb[2]).toBeGreaterThan(60);if(family===4)expect(rgb[2]-rgb[0]).toBeGreaterThan(80);
    const frame=r.partBounds.find(p=>p.part===part&&p.side===side)!;expect(frame).toBeDefined();expect(frame.minX).toBeLessThanOrEqual(x);expect(frame.maxX).toBeGreaterThan(x);expect(frame.minY).toBeLessThanOrEqual(y);expect(frame.maxY).toBeGreaterThan(y);
   }
  }
 }}finally{spy.mockRestore();}
 if(name==='jpeg')expect(calls).toBe(2);
},30000);

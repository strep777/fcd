import{expect,it}from'vitest';import{randomUUID}from'node:crypto';
import{sourceJunctions}from'../../packages/reference/image-tip-junctions';
import{illustrationRegions}from'../../packages/reference/illustration';
import{imageBoundaryFit,type BoundaryFit}from'../../packages/reference/image-contour';
import{recoverSharedContours}from'../../packages/reference/shared-contour';
import{contourPolyline}from'../../packages/reference/recover-contour';
import{traceMask}from'../../apps/desktop/main/reference-segmentation';
import type{Point}from'../../packages/schema/index';
import{width,height,palette,hex,p,pixels,inside}from'../fixtures/junction-border-source';

it('a legitimate single-owner image-border segment between two junctions never throws or erases its opaque middle core',()=>{
 const branches=[
  {raw:[p(0,0),p(0,23)],closed:false,colors:[hex[0]]},
  {raw:[p(0,23),p(0,35)],closed:false,colors:[hex[1]]},
  {raw:[p(0,35),p(0,64)],closed:false,colors:[hex[2]]},
  {raw:[p(0,23),p(62,23)],closed:false,colors:[hex[0],hex[1]]},
  {raw:[p(0,35),p(62,35)],closed:false,colors:[hex[1],hex[2]]}
 ],before=structuredClone(branches),rgba=pixels(),bytes=rgba.slice(),core=p(.5,30.5);expect(Array.from(rgba.slice(4*(30*width),4*(30*width)+4))).toEqual([...palette[1],255]);
 let answer:ReturnType<typeof sourceJunctions>;expect(()=>{answer=sourceJunctions(branches,width,height,rgba);}).not.toThrow();const out=answer?.output??before.map(b=>b.raw),upper=out[3],lower=out[4],middle=[...out[1],...lower.slice(1),p(64,lower.at(-1)!.yMm),p(64,upper.at(-1)!.yMm),...upper.slice(1).reverse()];
 expect(inside(core,middle)).toBe(true);for(const q of out[1])expect(Math.abs(q.xMm)).toBeLessThanOrEqual(1e-7);expect(branches).toEqual(before);expect(rgba).toEqual(bytes);
});
it('the same real three-material border image preserves all owners through classification, prepare and saved shared geometry',()=>{
 const rgba=pixels(),bytes=rgba.slice(),classified=illustrationRegions(width,height,rgba,false,'head'),seeds=[{xMm:.5,yMm:10.5},{xMm:.5,yMm:30.5},{xMm:.5,yMm:50.5}],ids=seeds.map(s=>classified.regions.findIndex(r=>r.indices.includes(Math.floor(s.yMm)*width+Math.floor(s.xMm))));expect(ids.every(i=>i>=0)).toBe(true);expect(new Set(ids).size).toBe(3);
 const calibration={a:{x:0,y:height},b:{x:0,y:0},distanceMm:height},raw=classified.regions.map(r=>{const mask=new Uint8Array(width*height);for(const i of r.indices)mask[i]=1;return traceMask(width,height,mask,calibration,width,height,r.color,true).piece;}),before=structuredClone(raw),fit=imageBoundaryFit(width,height,rgba,q=>({xMm:q.xMm,yMm:height-q.yMm}),q=>({xMm:q.xMm,yMm:height-q.yMm})),prepare=fit.prepare!;let preparationError:unknown,observations:unknown[]=[];
 fit.prepare=function(this:BoundaryFit,branches,contours){try{const out=prepare.call(this,branches,contours);observations.push({singleOwnerBranches:branches.filter(b=>b.colors.length===1).length,outputLengths:out?.map(r=>r.length)});return out;}catch(error){preparationError=error;throw error;}};
 const result=recoverSharedContours(raw,.8,randomUUID,fit),rings=result.pieces.map(piece=>[contourPolyline(piece.nodes,piece.curves??[],true,.001,randomUUID).map(q=>({...q,yMm:height-q.yMm})),...(piece.holes??[]).map(h=>h.map(q=>({...q,yMm:height-q.yMm})))]),owners=(s:Point)=>rings.flatMap((r,i)=>inside(s,r[0])&&!r.slice(1).some(h=>inside(s,h))?[i]:[]);
 expect(observations.length,'the complete route must actually call prepare').toBeGreaterThan(0);expect(preparationError,'a swallowed prepare exception is not a successful border path').toBeUndefined();seeds.forEach((s,i)=>expect(owners({...s,id:''})).toEqual([ids[i]]));let gaps=0,overlaps=0;for(let y=.317;y<height;y+=3.7)for(let x=.731;x<width;x+=3.7){const count=owners(p(x,y)).length;gaps+=+(count===0);overlaps+=+(count>1);}expect({gaps,overlaps}).toEqual({gaps:0,overlaps:0});expect(raw).toEqual(before);expect(rgba).toEqual(bytes);
});

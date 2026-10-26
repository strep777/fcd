import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {projectMarking} from '../../apps/desktop/main/markings';
import {anatomicalPlacement} from '../../apps/desktop/main/anatomical-placement';
import {parseObj} from '../../apps/desktop/main/surface';
import {markingSchema,type Project} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe');
function fixture(x=108,width=6){
  const p=project();p.pieces=[];p.markings=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng torso\nf 1 2 3\nf 1 3 4');
  const piece=rectangle(width,8);piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm+=x;n.yMm+=46;});
  piece.holes=[[[x+1.5,48],[x+1.5,49],[x+2.5,49],[x+2.5,48]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))];
  piece.curves=[{id:randomUUID(),startNodeId:piece.nodes[2].id,endNodeId:piece.nodes[3].id,c1:{id:randomUUID(),xMm:x+width*.7,yMm:54.25},c2:{id:randomUUID(),xMm:x+width*.3,yMm:54.25}}];
  const referenceId=randomUUID();p.patternLibrary=[{piece,referenceId,view:'front',category:'body',anatomy:{part:'body',side:'center',confidence:.9,method:'silhouette-1'}}];
  p.references=[{id:referenceId,name:'Independent full 100 mm body frame',view:'front',width:100,height:100,png:'data:image/png;base64,AA==',calibration:{a:{x:0,y:100},b:{x:0,y:0},distanceMm:100},illustration:{algorithm:'illustration-2',subject:'character',bounds:{minX:0,minY:0,maxX:100,maxY:100},partBounds:[{part:'body',bounds:{minX:0,minY:0,maxX:100,maxY:100}}],foregroundPixels:10000,discardedPixels:0,palette:[piece.color],smoothingPx:0}}];return p;
}
const auto=(p:Project)=>projectMarking(worker,p,p.patternLibrary![0].piece.id,'front',0,0,false,true);
it('refuses a nearby out-of-frame automatic accent without moving its pigment or changing its source',async()=>{
  const p=fixture(),before=structuredClone(p);await expect(auto(p)).rejects.toThrow('NO_VISIBLE_PROJECTION');expect(p).toEqual(before);
});
it('retains the original position, source curves, holes, uniform scale and pending review of a visible automatic accent',async()=>{
  const p=fixture(45),before=structuredClone(p),placement=anatomicalPlacement(p,p.patternLibrary![0]);
  const m=await auto(p);expect(m.fragments.length).toBeGreaterThan(0);expect(m.offsetXmm).toBe(0);expect(m.offsetYmm).toBe(0);
  expect(m.placement).toEqual(placement);expect(m.placement!.reviewed).toBe(false);expect(m.placement!.scaleX).toBe(1);expect(m.placement!.scaleY).toBe(1);
  expect(markingSchema.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);expect(p).toEqual(before);
  const faces=new Map(p.surface!.faces.map(f=>[f.id,f]));for(const f of m.fragments){expect(faces.get(f.faceId)!.region).toBe('torso');for(const ring of f.rings)for(const w of ring){expect(w.every(n=>n>=0&&n<=1)).toBe(true);expect(w.reduce((s,n)=>s+n,0)).toBeCloseTo(1,10);}}
});
it.each([['too-large',108,36],['too-far',140,6]] as const)('refuses %s automatic accents without mutation',async(_name,x,width)=>{
  const p=fixture(x,width),before=structuredClone(p);await expect(auto(p)).rejects.toThrow('NO_VISIBLE_PROJECTION');expect(p).toEqual(before);
});
it.each(['occluded','coincident'] as const)('does not recover onto a %s target sheet',async kind=>{
  const p=fixture(45),other=structuredClone(p.surface!),ids=new Map(other.vertices.map(v=>[v.id,randomUUID()]));other.vertices.forEach(v=>{v.id=ids.get(v.id)!;v.zMm=kind==='occluded'?10:0;});other.faces.forEach(f=>{f.id=randomUUID();f.vertices=f.vertices.map(id=>ids.get(id)!) as [string,string,string];f.region='arm-left';});p.surface!.vertices.push(...other.vertices);p.surface!.faces.push(...other.faces);
  const before=structuredClone(p);await expect(auto(p)).rejects.toThrow(kind==='coincident'?'AMBIGUOUS_PROJECTION':'NO_VISIBLE_PROJECTION');expect(p).toEqual(before);
});
it('does not convert a genuine overlapping-sheet projection error into local movement',async()=>{
  const p=fixture(45),other=structuredClone(p.surface!),ids=new Map(other.vertices.map(v=>[v.id,randomUUID()]));other.vertices.forEach(v=>v.id=ids.get(v.id)!);other.faces.forEach(f=>{f.id=randomUUID();f.vertices=f.vertices.map(id=>ids.get(id)!) as [string,string,string];});p.surface!.vertices.push(...other.vertices);p.surface!.faces.push(...other.faces);
  const before=structuredClone(p);await expect(auto(p)).rejects.toThrow('AMBIGUOUS_PROJECTION');expect(p).toEqual(before);
});
it('leaves the explicit manual projection at its exact requested position',async()=>{
  const p=fixture(),before=structuredClone(p);await expect(projectMarking(worker,p,p.patternLibrary![0].piece.id,'front',0,0)).rejects.toThrow('NO_VISIBLE_PROJECTION');expect(p).toEqual(before);
});
it.each(['existing','manual-existing','locked'] as const)('never changes a %s marking to rescue a new no-visible request',async kind=>{
  const p=fixture(45),m=await auto(p);m.placement!.reviewed=true;if(kind==='manual-existing'){m.source='manual';m.editMode='uv-manual';}if(kind==='locked')m.locked=true;p.markings=[m];const piece=p.patternLibrary![0].piece;for(const point of [...piece.nodes,...piece.holes!.flat(),...piece.curves!.flatMap(c=>[c.c1,c.c2])])point.xMm+=63;const before=structuredClone(p);
  await expect(auto(p)).rejects.toThrow(kind==='locked'?'MARKING_LOCKED':kind==='manual-existing'?'MANUAL_MARKING_REVIEW':'NO_VISIBLE_PROJECTION');expect(p).toEqual(before);
});
it('an explicit face scope cannot be replaced by a nearby different part',async()=>{
  const p=fixture(45),before=structuredClone(p);await expect(projectMarking(worker,p,p.patternLibrary![0].piece.id,'front',0,0,false,true,undefined,new Set())).rejects.toThrow('NO_VISIBLE_PROJECTION');expect(p).toEqual(before);
});

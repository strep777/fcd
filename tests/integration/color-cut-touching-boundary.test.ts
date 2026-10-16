import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {unwrapSurface,bindingIssues,pieceGeometryHash} from '../../apps/desktop/main/surface';
import {colorCuts} from '../../apps/desktop/main/color-cuts';
import {projectMarking} from '../../apps/desktop/main/markings';
import {analyze} from '../../apps/desktop/main/worker';
import type {Surface,Binding} from '../../packages/schema/index';
const worker=resolve('target/release/fpcad-worker.exe');
const area=(trim:NonNullable<Binding['trim']>)=>{const v=new Map(trim.vertices.map(v=>[v.id,v]));return trim.triangles.reduce((sum,t)=>{const [a,b,c]=t.vertices.map(id=>v.get(id)!);return sum+Math.abs((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;},0);};
it('real touching color/hole contours produce exact usable surface maps without zero-area sewing spurs',async()=>{
 const fixture=JSON.parse(readFileSync('tests/fixtures/color-touching-boundary.json','utf8')) as {polygon:{outer:[number,number][];holes:[number,number][][]};faces:{id:string;triangle:[number,number][]}[]};
 const p=project();p.pieces=[];const vertices:Surface['vertices']=[],ids=new Map<string,string>();
 const faces=fixture.faces.map(f=>({id:randomUUID(),region:'panel',vertices:f.triangle.map(([xMm,yMm])=>{const key=xMm+':'+yMm;let id=ids.get(key);if(!id){id=randomUUID();ids.set(key,id);vertices.push({id,xMm,yMm,zMm:0});}return id;}) as [string,string,string]}));
 p.surface={id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces};
 const run=await unwrapSurface(worker,p.surface,p,{automaticCuts:false,normalAngleDeg:180});expect(run.pieces).toHaveLength(1);
 const binding=run.bindings[0],positions=new Map(vertices.map(v=>[v.id,v]));binding.report.uv=vertices.map(v=>({vertexId:v.id,xMm:v.xMm,yMm:v.yMm}));run.pieces[0].nodes=binding.report.boundary.map(id=>({id:randomUUID(),xMm:positions.get(id)!.xMm,yMm:positions.get(id)!.yMm}));binding.geometryHash=pieceGeometryHash(run.pieces[0]);
 const source=rectangle(30,10);source.allowanceMm=0;source.nodes.forEach(n=>{n.xMm+=1585;n.yMm+=60;});p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'test'}];const marking=await projectMarking(worker,p,source.id,'front',0,0);marking.paths=[{pieceId:run.pieces[0].id,geometryHash:binding.geometryHash,rings:[fixture.polygon.outer,...fixture.polygon.holes].map(r=>r.map(([xMm,yMm])=>({xMm,yMm})))}];p.markings=[marking];
 const colored=await colorCuts(worker,p,run,[marking]);expect(colored.pieces.length).toBeGreaterThan(1);expect(bindingIssues({...p,pieces:colored.pieces,bindings:colored.bindings})).toEqual([]);expect((await analyze(worker,{...p,pieces:colored.pieces})).flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
 const sourceArea=faces.reduce((sum,f)=>{const [a,b,c]=f.vertices.map(id=>positions.get(id)!);return sum+Math.abs((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;},0);expect(colored.bindings.reduce((sum,b)=>sum+area(b.trim!),0)).toBeCloseTo(sourceArea,5);for(const b of colored.bindings){expect(new Set(b.trim!.boundary).size).toBe(b.trim!.boundary.length);expect(b.trim!.vertices.length).toBeGreaterThanOrEqual(3);}
});

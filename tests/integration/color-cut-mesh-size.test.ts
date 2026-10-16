import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project,rectangle} from '../fixtures';
import {parseObj,unwrapSurface,bindingIssues} from '../../apps/desktop/main/surface';
import {projectMarking} from '../../apps/desktop/main/markings';
import {colorCuts} from '../../apps/desktop/main/color-cuts';
import {analyze} from '../../apps/desktop/main/worker';
const worker=resolve('target/release/fpcad-worker.exe');
it('keeps a detailed curved insert on a dense mesh compact enough for project acceptance and storage',async()=>{
 const n=20,rows:string[]=[];for(let y=0;y<=n;y++)for(let x=0;x<=n;x++)rows.push(`v ${x*10} ${y*10} 0`);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=y*(n+1)+x+1,b=a+1,c=a+n+1,d=c+1;rows.push(`f ${a} ${b} ${d}`,`f ${a} ${d} ${c}`);}
 const p=project();p.pieces=[];p.surface=parseObj(rows.join('\n'));
 const run=await unwrapSurface(worker,p.surface,p,{automaticCuts:false,normalAngleDeg:180,maxFacesPerPatch:2000});expect(run.pieces).toHaveLength(1);
 p.pieces=run.pieces;p.bindings=run.bindings;const source=rectangle();source.color='#ff0000';source.allowanceMm=0;source.nodes=Array.from({length:200},(_,i)=>({id:randomUUID(),xMm:100+60*Math.cos(i*Math.PI/100),yMm:100+60*Math.sin(i*Math.PI/100)}));
 p.patternLibrary=[{piece:source,referenceId:randomUUID(),view:'front',category:'test'}];const marking=await projectMarking(worker,p,source.id,'front',0,0);p.markings=[marking];
 const result=await colorCuts(worker,p,run,[marking]),triangles=result.bindings.flatMap(b=>b.trim?.triangles??[]),candidate={...p,pieces:result.pieces,bindings:result.bindings};
 expect(result.pieces).toHaveLength(2);expect(triangles.length).toBeLessThan(3*(p.surface.faces.length+source.nodes.length));
 expect(JSON.stringify(result).length).toBeLessThan(2_000_000);
 const faces=new Map(p.surface.faces.map(f=>[f.id,f]));
 for(const b of result.bindings){const required=new Set([...b.report.boundary,...b.report.faceIds.flatMap(id=>faces.get(id)!.vertices)]);expect(new Set(b.report.uv.map(v=>v.vertexId))).toEqual(required);}
 expect(result.bindings.some(b=>b.report.uv.length<run.bindings[0].report.uv.length)).toBe(true);
 let total=0;for(const b of result.bindings){const v=new Map(b.trim!.vertices.map(p=>[p.id,p]));for(const t of b.trim!.triangles){const [a,c,d]=t.vertices.map(id=>v.get(id)!);total+=Math.abs((c.xMm-a.xMm)*(d.yMm-a.yMm)-(d.xMm-a.xMm)*(c.yMm-a.yMm))/2;for(const w of t.barycentric){expect(w.reduce((s,n)=>s+n,0)).toBeCloseTo(1,10);expect(w.every(n=>n>=0&&n<=1)).toBe(true);}}}
 expect(total).toBeCloseTo(40000,5);expect(bindingIssues(candidate).filter(i=>i.severity==='error')).toEqual([]);expect((await analyze(worker,candidate)).flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
},30000);

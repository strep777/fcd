import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {cutPreview} from '../../apps/desktop/main/cut-preview';
import type {Surface} from '../../packages/schema/index';
it('a densely tessellated conical panel opens with one dart, not strips',async()=>{
 const n=64,levels=6,vertices:Surface['vertices']=[{id:randomUUID(),xMm:0,yMm:0,zMm:100}],faces:Surface['faces']=[];
 for(let level=1;level<=levels;level++)for(let j=0;j<n;j++){const r=100*level/levels,t=2*Math.PI*j/n;vertices.push({id:randomUUID(),xMm:r*Math.cos(t),yMm:r*Math.sin(t),zMm:100-r});}
 const emit=(ids:number[])=>faces.push({id:randomUUID(),vertices:ids.map(i=>vertices[i].id) as [string,string,string],region:'panel'});
 for(let j=0;j<n;j++){const next=(j+1)%n;emit([0,1+j,1+next]);for(let level=1;level<levels;level++){const a=1+(level-1)*n+j,b=1+(level-1)*n+next,c=a+n,d=b+n;emit([a,c,d]);emit([a,d,b]);}}
 const p=project();p.pieces=[];p.defaultAllowanceMm=0;p.surface={id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces};const before=JSON.stringify(p);
 const candidate=await cutPreview(resolve('target/release/fpcad-worker.exe'),p.surface,p,{method:'arap',automaticCuts:true,partitionStrategy:'design',iterations:60},resolve('dist/assets'));
 expect(candidate.run.pieces).toHaveLength(1);expect(candidate.run.bindings[0].report.edgeErrorMax).toBeLessThan(.1);expect(candidate.run.bindings[0].report.seamLengthErrorMm??0).toBeLessThanOrEqual(.25);expect(JSON.stringify(p)).toBe(before);
},120000);

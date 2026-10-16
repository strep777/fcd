import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {parseObj,validateSurface} from '../../apps/desktop/main/surface';
import {cutComponents,editSurfaceCuts} from '../../apps/desktop/main/cut-tools';
import type {CutProjection} from '../../packages/schema/index';

const projection:CutProjection={origin:[0,100,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},point=(xMm:number,yMm:number)=>({id:randomUUID(),xMm,yMm,zMm:0}),worker=resolve('target/release/fpcad-worker.exe');
it('resumes a symmetric pen after insertion and point adjustment on the repeatedly refined panel',async()=>{
 let p=project();p.pieces=[];p.surface=parseObj('v -100 0 0\nv 100 0 0\nv 100 200 0\nv -100 200 0\nf 1 2 3\nf 1 3 4');
 const controls=[point(19.467275934870003,20.44653960725339),point(74.55129132082021,100.40720710298754),point(19.467275934870006,180.3678745987217)],base={type:'surface.curve' as const,name:'Resume',kind:'pen' as const,projection,tension:.5,closed:false,symmetric:true};
 p={...p,...await editSurfaceCuts(worker,p,{...base,controlPoints:controls})};const id=p.surface!.cutLines![0].id;
 const edited=[controls[0],point(47.00928362784511,60.42687335512046),{...controls[1],xMm:65},controls[2]];
 p={...p,...await editSurfaceCuts(worker,p,{...base,id,controlPoints:edited})};validateSurface(p.surface!);
 p={...p,...await editSurfaceCuts(worker,p,{...base,id,controlPoints:[...edited,point(30,190)]})};validateSurface(p.surface!);
 expect(p.surface!.cutLines).toHaveLength(2);expect(p.surface!.cutLines![0].controlPoints).toHaveLength(5);expect(p.surface!.cutLines![1].mirroredFrom).toBe(id);
 for(const line of p.surface!.cutLines!)expect(cutComponents(line.edges)).toHaveLength(1);
 const vertices=new Map(p.surface!.vertices.map(v=>[v.id,v])),area=p.surface!.faces.reduce((sum,f)=>{const [a,b,c]=f.vertices.map(id=>vertices.get(id)!);return sum+Math.abs((b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm))/2;},0);expect(area).toBeCloseTo(40000,6);
});

it('cuts a genuinely narrow panel but still rejects a nearby path outside its edge',async()=>{
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 0.0001 0\nv 0 0.0001 0\nf 1 2 3\nf 1 3 4');
 const base={type:'surface.curve' as const,name:'Narrow',kind:'freehand' as const,projection,tension:1,closed:false,symmetric:false};
 const result=await editSurfaceCuts(worker,p,{...base,controlPoints:[point(10,.00005),point(90,.00005)]});validateSurface(result.surface);expect(cutComponents(result.surface.cutLines![0].edges)).toHaveLength(1);
 await expect(editSurfaceCuts(worker,p,{...base,controlPoints:[point(10,-.00001),point(90,-.00001)]})).rejects.toThrow('CUT_OUTSIDE_SURFACE');
});

import {randomUUID} from 'node:crypto';
import UPNG from '@pdf-lib/upng';
import {resolve} from 'node:path';
import type {Project,Reference} from '../../packages/schema/index';
import {project,rectangle} from '../fixtures';
import {referenceFromPng} from '../../apps/desktop/main/references';
import {parseObj} from '../../apps/desktop/main/surface';
import {projectMarking} from '../../apps/desktop/main/markings';
const codec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG;
export const fabricWorker=resolve(process.env.FPCAD_MATERIAL_WORKER??'target/release/fpcad-worker.exe');
export function fabricReferences(front=['#ede7ea','#04a3f0','#f9e33c'],back=['#dcd0d7','#02a6f4','#f7e13c']):Reference[]{
 return ([['front',front],['back',back]] as const).map(([view,colors])=>{
  const data=new Uint8Array(100*100*4);for(let y=0;y<100;y++)for(let x=0;x<100;x++){const c=colors[Math.min(colors.length-1,Math.floor(x*colors.length/100))]??'#000000';data.set([parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16),255],(y*100+x)*4);}
  const png=Buffer.from(codec.encode([data.buffer],100,100,0)),r=referenceFromPng(png,'Analytic material '+view,view);r.calibration={a:{x:0,y:100},b:{x:0,y:0},distanceMm:100};r.calibrationMode='manual';r.illustration={algorithm:'illustration-2',subject:'character',bounds:{minX:0,minY:0,maxX:100,maxY:100},partBounds:[{part:'body',side:'center',bounds:{minX:0,minY:0,maxX:100,maxY:100}}],foregroundPixels:10000,discardedPixels:0,palette:colors,smoothingPx:0};return r;
 });
}
export function fabricMetadata(front?:string[],back?:string[]):Project{return{...project(),pieces:[],references:fabricReferences(front,back)};}
export async function referenceFabricPlane(locked=false){
 const p=fabricMetadata();p.defaultAllowanceMm=0;p.surface=parseObj('v 0 0 0\nv 50 0 0\nv 100 0 0\nv 0 100 0\nv 50 100 0\nv 100 100 0\ng torso\nf 1 2 5\nf 1 5 4\nf 2 3 6\nf 2 6 5');
 if(locked){const ids=p.surface.vertices.filter(v=>v.xMm===50).map(v=>v.id);p.surface.cutConstraints=[{a:ids[0],b:ids[1],locked:true}];}
 const source=(x:number,y:number,w:number,h:number,color:string,name:string,view:'front'|'back')=>{const piece=rectangle(w,h);piece.name=name;piece.color=color;piece.allowanceMm=0;piece.nodes.forEach(n=>{n.xMm+=x;n.yMm+=y;});return{piece,referenceId:p.references!.find(r=>r.view===view)!.id,view,category:'body',anatomy:{part:'body' as const,side:'center' as const,confidence:1,method:'silhouette-1' as const}};};
 p.patternLibrary=[source(0,0,50,100,'#ede7ea','White source','front'),source(30,30,20,20,'#04a3f0','Blue front source','front'),source(50,30,20,20,'#02a6f4','Blue back source','back'),source(70,70,20,20,'#f9e33c','Yellow source','front')];
 p.markings=[];
 // Both reference-view pigments are placed by the public projection helper
 // on adjacent parts of one analytic front-facing cloth sheet. This isolates
 // material interpretation from anatomical placement, tested separately.
 for(const source of p.patternLibrary)p.markings.push(await projectMarking(fabricWorker,p,source.piece.id,'front',0,0));
 return p;
}

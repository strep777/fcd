import {beforeAll,expect,it} from 'vitest';
import {build} from 'esbuild';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {project,rectangle} from '../fixtures';
import {Repository} from '../../apps/desktop/main/repository';
import {parseObj} from '../../apps/desktop/main/surface';
import {staleMarkingIds} from '../../apps/desktop/main/markings';
import {registrationFingerprint} from '../../packages/reference/placement-registration';
let runtime:typeof import('../../apps/desktop/main/surface-runtime');
const worker=resolve('target/release/fpcad-worker.exe'),signal=()=>new AbortController().signal;
beforeAll(async()=>{
 await mkdir('.local/tests',{recursive:true});const directory=await mkdtemp(resolve('.local/tests/placement-runtime-'));
 // Exercise the production thread boundary in an isolated fixture. Neither dist
 // nor the application currently under desktop regression is rebuilt.
 await Promise.all(['surface-runtime','surface-worker'].map(name=>build({entryPoints:[`apps/desktop/main/${name}.ts`],bundle:true,platform:'node',format:'cjs',external:['node:sqlite'],outfile:resolve(directory,name+'.cjs'),logLevel:'silent'})));
 runtime=createRequire(import.meta.url)(resolve(directory,'surface-runtime.cjs'));
});
function registered(){
 const p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\ng head\nf 1 2 3\nf 1 3 4');const referenceId=randomUUID(),piece=rectangle(10,10);piece.allowanceMm=0;
 p.references=[{id:referenceId,name:'Head source',view:'front',width:100,height:100,png:'data:image/png;base64,AA==',calibration:{a:{x:0,y:100},b:{x:0,y:0},distanceMm:100},illustration:{algorithm:'illustration-2',subject:'head',bounds:{minX:0,minY:0,maxX:100,maxY:100},partBounds:[{part:'head',bounds:{minX:0,minY:0,maxX:100,maxY:100}}],foregroundPixels:10000,discardedPixels:0,palette:['#ffffff'],smoothingPx:0}}];
 p.patternLibrary=[{piece,referenceId,view:'front',category:'head',anatomy:{part:'head',side:'center',confidence:1,method:'manual'}}];return p;
}
it('threaded auto placement preserves reference registration, full-part dimensions, review and downstream cutting',async()=>{
 const p=registered(),region=p.patternLibrary![0],marking=await runtime.runProjection(worker,p,region.piece.id,'front',0,0,signal(),false,true);
 expect(marking.placement!.sourceGroupHash).toBe(registrationFingerprint(p,region));expect(marking.placement!.scaleX).toBe(1);p.markings=[marking];expect(staleMarkingIds(p).size).toBe(0);
 const repo=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'marking.placement.review',markingIds:[marking.id],reviewed:true},randomUUID(),'review');const approved=repo.snapshot()!;expect(approved.markings![0].placement!.reviewed).toBe(true);
 const result=await runtime.runCutPreview(worker,approved.surface!,approved,{automaticCuts:true,colorBoundaryCuts:true,normalAngleDeg:180},resolve('dist/assets'),signal());const preview={...approved,pieces:result.run.pieces,bindings:result.run.bindings,markings:result.markings};expect(result.run.pieces.length).toBeGreaterThan(1);expect(staleMarkingIds(preview).size).toBe(0);expect(result.markings[0].paths.length).toBeGreaterThan(0);
 }finally{repo.close();}
});
it('threaded source contour editing refreshes the same reference group without orphaning sibling placement review',async()=>{
 const p=registered(),first=p.patternLibrary![0],second={...first,piece:rectangle(10,10)};second.piece.allowanceMm=0;second.piece.nodes.forEach(n=>n.xMm+=20);p.patternLibrary!.push(second);p.markings=[];for(const region of p.patternLibrary!)p.markings.push(await runtime.runProjection(worker,p,region.piece.id,'front',0,0,signal(),false,true));
 const piece=structuredClone(first.piece);piece.nodes[0].xMm+=1;const result=await runtime.runEditLibraryRegion(worker,p,piece.id,{piece,operations:[]},signal()),after={...p,patternLibrary:[result.region,second],markings:result.markings,modelLibrary:result.models};expect(result.markings).toHaveLength(2);expect(staleMarkingIds(after).size).toBe(0);expect(result.markings[1].placement!.sourceGroupHash).toBe(registrationFingerprint(after,second));
 const repo=new Repository(':memory:');try{repo.open(after,null);repo.commit({type:'marking.placement.review',markingIds:result.markings.map(m=>m.id),reviewed:true},randomUUID(),'review edited pigments');expect(repo.snapshot()!.markings!.every(m=>m.placement!.reviewed)).toBe(true);}finally{repo.close();}
});

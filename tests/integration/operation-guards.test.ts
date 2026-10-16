import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Repository} from '../../apps/desktop/main/repository';
import {parseObj} from '../../apps/desktop/main/surface';
import {splitEdge,duplicatePiece,edgeArcPoints} from '../../packages/pattern/edit';
import {materialSchema,pieceSchema} from '../../packages/schema/index';
import {project,rectangle} from '../fixtures';
import {layout} from '../../apps/desktop/main/export';
import {pairedNotches} from '../../apps/desktop/main/seam-notches';
import {seamIssues} from '../../packages/manufacturing/seams';
import {assertOutputBudget} from '../../packages/manufacturing/output-limits';
import {MESH_VERTICES,MESH_FACES} from '../../packages/surface/limits';
import {issueMessages} from '../../apps/desktop/src/i18n';

const material=()=>materialSchema.parse({id:randomUUID(),name:'内衬',version:1,category:'lining',thicknessMm:1,furLengthMm:0,compensationMm:0,defaultAllowanceMm:10,furRequired:false,grainRequired:false,rotationsRad:[0],seamToleranceMm:1,stretchWarpRatio:0,stretchWeftRatio:0,measurementSource:'measured',sourceNote:''});
describe('unexpected editing operations preserve project integrity',()=>{
 it('retains materials used by inactive saved models or extracted regions',()=>{
  for(const location of ['model','region'] as const){const p=project(),m=material(),piece=rectangle();piece.materialId=m.id;piece.material=m.name;p.materials=[m];
   if(location==='model'){const surface=parseObj('v 0 0 0\nv 100 0 0\nv 0 100 0\nf 1 2 3');p.modelLibrary=[{id:surface.id,name:'已保存模型',surface,pieces:[piece]}];}
   else p.patternLibrary=[{piece,referenceId:randomUUID(),view:'front',category:'白色'}];
   const repo=new Repository(':memory:');try{repo.open(p,null);const before=repo.snapshot(),status=repo.status();expect(()=>repo.commit({type:'material.delete',materialId:m.id},randomUUID(),'delete')).toThrow('MATERIAL_IN_USE');expect(repo.snapshot()).toEqual(before);expect(repo.status()).toEqual(status);}finally{repo.close();}
  }
 });
 it('refuses a closing-edge edit on an open path without creating phantom geometry',()=>{
  const p=rectangle();p.closed=false;const before=structuredClone(p);
  expect(()=>splitEdge(p,p.nodes.at(-1)!.id)).toThrow('INVALID_EDGE');
  expect(()=>edgeArcPoints(p,p.nodes.at(-1)!.id)).toThrow('INVALID_EDGE');expect(p).toEqual(before);
  expect(splitEdge(p,p.nodes[0].id).nodes).toHaveLength(5);
 });
 it('duplicates paired notches as manual notches without retaining the original seam association',()=>{
  const p=rectangle();p.notches=[{id:randomUUID(),sourceSeamId:randomUUID(),nodeId:p.nodes[0].id,position:.5,depthMm:3,label:'配对剪口'}];
  const copy=duplicatePiece(p);expect(copy.notches![0].sourceSeamId).toBeUndefined();expect(copy.notches![0].nodeId).toBe(copy.nodes[0].id);expect(p.notches[0].sourceSeamId).toBeDefined();
 });
 it('rejects duplicate contour identities before an editor can select and move the wrong nodes',()=>{
  const p=rectangle();p.nodes[1].id=p.nodes[0].id;expect(()=>pieceSchema.parse(p)).toThrow();
  const other=rectangle();other.holes=[[{...other.nodes[0]},{id:randomUUID(),xMm:20,yMm:20},{id:randomUUID(),xMm:30,yMm:20}]];expect(()=>pieceSchema.parse(other)).toThrow();
 });
 it('removes generated notch dependencies when unlinking a seam and preserves manual notches',()=>{
  const p=project(),a=p.pieces[0],b=rectangle();p.pieces.push(b);const side=(piece:typeof a)=>({pieceId:piece.id,nodeId:piece.nodes[0].id,endNodeId:piece.nodes[1].id,start:0,end:1,reverse:false});
  const seam={id:randomUUID(),name:'配对',a:side(a),b:side(b),expectedEaseMm:0,toleranceMm:1,locked:false};p.seams=[seam];p.pieces=pairedNotches(p,seam.id,3,3);
  const manual={id:randomUUID(),nodeId:a.nodes[2].id,position:.5,depthMm:3,label:'手动'};p.pieces[0].notches!.push(manual);
  const repo=new Repository(':memory:');try{repo.open(p,null);repo.commit({type:'seam.delete',seamId:seam.id},randomUUID(),'unlink');expect(repo.snapshot()!.pieces[0].notches).toEqual([manual]);expect(repo.snapshot()!.pieces[1].notches).toEqual([]);}finally{repo.close();}
 });
 it('blocks output when paired notches are moved independently of their mating side',async()=>{
  const {analyze}=await import('../../apps/desktop/main/worker'),{resolve}=await import('node:path');const p=project(),a=p.pieces[0],b=rectangle();p.pieces.push(b);
  const side=(piece:typeof a)=>({pieceId:piece.id,nodeId:piece.nodes[0].id,endNodeId:piece.nodes[1].id,start:0,end:1,reverse:false});const seam={id:randomUUID(),name:'配对',a:side(a),b:side(b),expectedEaseMm:0,toleranceMm:1,locked:false};p.seams=[seam];p.pieces=pairedNotches(p,seam.id,3,3);
  p.pieces[0].notches![0].position=.3;expect(seamIssues(p,await analyze(resolve('target/release/fpcad-worker.exe'),p)).some(i=>i.messageKey==='STALE_SEAM_NOTCHES')).toBe(true);
 });
 it('bounds manufacturing instances before allocating repeated output coordinates',()=>{
  const p=project();p.pieces=Array.from({length:21},()=>({...rectangle(),cutQty:100}));const geometry=p.pieces.map(piece=>({id:piece.id,cut:piece.nodes,seam:piece.nodes,areaMm2:20000,perimeterMm:600,issues:[]}));expect(()=>layout(p,geometry)).toThrow('RESOURCE_LIMIT');
 });
 it('bounds repeated coordinates as well as instance counts',()=>{
  const p=project();p.pieces[0].cutQty=100;const geometry=[{id:p.pieces[0].id,cut:Array.from({length:10001},()=>p.pieces[0].nodes[0]),areaMm2:20000,perimeterMm:600,issues:[]}];expect(()=>assertOutputBudget(p,geometry)).toThrow('RESOURCE_LIMIT');expect(()=>layout(p,geometry)).toThrow('RESOURCE_LIMIT');
 });
 it('keeps automatic copy names valid when the source name is at the allowed limit',()=>{
  const p=rectangle();p.name='兽'.repeat(120);const copy=duplicatePiece(p);expect(()=>pieceSchema.parse(copy)).not.toThrow();expect(copy.name.endsWith(' copy')).toBe(true);
 });
 it('keeps boolean result names valid when the source name is at the allowed limit',async()=>{
  const {booleanPieces}=await import('../../apps/desktop/main/worker'),{resolve}=await import('node:path');const a=rectangle(),b=rectangle();a.name='兽'.repeat(120);b.nodes=b.nodes.map(n=>({...n,xMm:n.xMm+50}));const result=await booleanPieces(resolve('target/release/fpcad-worker.exe'),a,b,'union');expect(result).toHaveLength(1);expect(result[0].name.length).toBeLessThanOrEqual(120);
 });
 it('describes the actual mesh limits when a large import is rejected',()=>{expect(issueMessages.MESH_LIMIT[1]).toContain(String(MESH_VERTICES));expect(issueMessages.MESH_LIMIT[1]).toContain(String(MESH_FACES));});
});

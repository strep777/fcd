import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {commandSchema,surfaceSchema,type Surface} from '../packages/schema/index';
import {transformSurface,type ModelTransform} from '../packages/surface/transform';

const input=(patch:Partial<ModelTransform>={}):ModelTransform=>({type:'surface.transform',translationMm:{x:0,y:0,z:0},rotationDeg:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},...patch});
function sheet():Surface{
 const vertices=[[0,0,0],[100,0,0],[100,100,0],[0,100,0]].map(([xMm,yMm,zMm])=>({id:randomUUID(),xMm,yMm,zMm}));
 return surfaceSchema.parse({id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces:[{id:randomUUID(),vertices:[vertices[0].id,vertices[1].id,vertices[2].id],region:'lower'},{id:randomUUID(),vertices:[vertices[0].id,vertices[2].id,vertices[3].id],region:'upper'}]});
}
function closePoint(actual:{xMm:number;yMm:number;zMm:number},expected:number[]){for(const [i,axis] of (['xMm','yMm','zMm'] as const).entries())expect(actual[axis]).toBeCloseTo(expected[i],9);}
it('whole-object translation changes all XYZ coordinates in millimetres while preserving input and vertex identity',()=>{
 const old=sheet(),before=structuredClone(old),result=transformSurface(old,input({translationMm:{x:17,y:-23,z:31}}));
 const expected=[[17,-23,31],[117,-23,31],[117,77,31],[17,77,31]];
 result.surface.vertices.forEach((v,i)=>{closePoint(v,expected[i]);expect(v.id).toBe(old.vertices[i].id);});
 expect(result.all).toBe(true);expect(result.surface.faces).toEqual(old.faces);expect(result.surface.topologyVersion).toBe(2);expect(old).toEqual(before);
});
it('nonuniform scale uses the selected bounding-box centre when no explicit pivot is provided',()=>{
 const old=sheet(),result=transformSurface(old,input({scale:{x:2,y:3,z:4}}));
 const expected=[[-50,-100,0],[150,-100,0],[150,200,0],[-50,200,0]];
 result.surface.vertices.forEach((v,i)=>closePoint(v,expected[i]));
});
it('composed scale and 90-degree XYZ rotations follow the published order around an explicit pivot',()=>{
 const old=sheet();old.vertices=old.vertices.map(v=>({...v,xMm:v.xMm+1,yMm:v.yMm+2,zMm:3}));
 const result=transformSurface(old,input({pivotMm:{x:0,y:0,z:0},scale:{x:2,y:3,z:4},rotationDeg:{x:90,y:90,z:90},translationMm:{x:10,y:20,z:30}}));
 // (1,2,3) -> scale (2,6,12) -> X (2,-12,6) -> Y (6,-12,-2) -> Z (12,6,-2).
 const expected=[[22,26,28],[22,26,-172],[22,326,-172],[22,326,28]];
 result.surface.vertices.forEach((v,i)=>closePoint(v,expected[i]));
});
it('a fully selected face may rotate 180 degrees without being mistaken for a fold',()=>{
 const result=transformSurface(sheet(),input({rotationDeg:{x:180,y:0,z:0}}));
 closePoint(result.surface.vertices[0],[0,100,0]);closePoint(result.surface.vertices[2],[100,0,0]);
});
it('region and vertex edits move only selected vertices and keep shared boundary topology',()=>{
 const old=sheet(),byRegion=transformSurface(old,input({regions:['lower'],translationMm:{x:0,y:0,z:5}}));
 expect(byRegion.all).toBe(false);expect(byRegion.surface.vertices.map(v=>v.zMm)).toEqual([5,5,5,0]);expect(byRegion.surface.faces).toEqual(old.faces);
 const byVertex=transformSurface(old,input({vertexIds:[old.vertices[1].id],translationMm:{x:10,y:0,z:0}}));
 expect(byVertex.all).toBe(false);closePoint(byVertex.surface.vertices[1],[110,0,0]);expect(byVertex.surface.vertices.filter((_,i)=>i!==1)).toEqual(old.vertices.filter((_,i)=>i!==1));
});
it('empty, unknown or partially unknown selections fail without modifying input',()=>{
 const old=sheet(),before=structuredClone(old);
 for(const selection of [{vertexIds:[]},{regions:[]},{vertexIds:[randomUUID()]},{regions:['missing']},{vertexIds:[old.vertices[0].id,randomUUID()]},{regions:['lower','missing']}]){
  expect(()=>transformSurface(old,input(selection))).toThrow('MODEL_SELECTION_EMPTY');expect(old).toEqual(before);
 }
 expect(commandSchema.safeParse(input({vertexIds:[old.vertices[0].id],regions:['lower']})).success).toBe(false);
});
it('degenerate, flipped or invalid transforms reject the entire edit',()=>{
 const old=sheet(),before=structuredClone(old);
 for(const command of [input({vertexIds:[old.vertices[0].id],translationMm:{x:100,y:0,z:0}}),input({vertexIds:[old.vertices[0].id],translationMm:{x:150,y:0,z:0}})]){
  expect(()=>transformSurface(old,command)).toThrow('TEMPLATE_INVERSION');expect(old).toEqual(before);
 }
 for(const scale of [0,-1,1001,NaN,Infinity]){expect(()=>transformSurface(old,input({scale:{x:scale,y:1,z:1}}))).toThrow('MODEL_TRANSFORM_INVALID');expect(old).toEqual(before);}
});
it('transformed editing planes reproduce the same world-space paint points and retain orthonormal axes',()=>{
 const result=transformSurface(sheet(),input({pivotMm:{x:0,y:0,z:0},scale:{x:2,y:3,z:4},rotationDeg:{x:90,y:90,z:90},translationMm:{x:10,y:20,z:30}}));
 const shape={origin:[1,2,3] as [number,number,number],axes:[[1,0,0],[0,Math.SQRT1_2,Math.SQRT1_2],[0,-Math.SQRT1_2,Math.SQRT1_2]] as [[number,number,number],[number,number,number],[number,number,number]],nodes:[{xMm:0,yMm:0},{xMm:2,yMm:0},{xMm:0,yMm:Math.SQRT2}],holes:[]};
 const transformed=result.shape(shape),expected=[[22,26,28],[22,26,24],[26,29,28]];
 transformed.nodes.forEach((p,i)=>{
  const world=transformed.origin.map((o,a)=>o+transformed.axes[0][a]*p.xMm+transformed.axes[1][a]*p.yMm);
  world.forEach((n,a)=>expect(n).toBeCloseTo(expected[i][a],9));
 });
 for(const axis of transformed.axes)expect(Math.hypot(...axis)).toBeCloseTo(1,9);
 expect(transformed.axes[0].reduce((n,x,i)=>n+x*transformed.axes[1][i],0)).toBeCloseTo(0,9);
});

it('partial edits transport a cut knot barycentrically with the bent face',()=>{
 const old=sheet();old.cutLines=[{id:randomUUID(),name:'Cut',kind:'freehand',enabled:true,closed:false,symmetric:false,tension:0,controlPoints:[{id:randomUUID(),xMm:75,yMm:25,zMm:0},{id:randomUUID(),xMm:25,yMm:75,zMm:0}],edges:[]}];
 const result=transformSurface(old,input({vertexIds:[old.vertices[1].id],translationMm:{x:0,y:0,z:20}}));
 closePoint(result.surface.cutLines![0].controlPoints[0],[75,25,10]);
 closePoint(result.surface.cutLines![0].controlPoints[1],[25,75,0]);
 closePoint(old.cutLines[0].controlPoints[0],[75,25,0]);
});

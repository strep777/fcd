import {expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import type {CutProjection,Marking,Piece,Project,Surface,SurfaceRun} from '../../packages/schema/index';
import {editableShape,shapeWorld,type Shape} from '../../packages/surface/attached-edit';
import {project} from '../fixtures';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const geometryHash=(piece:Piece)=>hash({nodes:piece.nodes,holes:piece.holes??[],curves:piece.curves??[]});
const edgeOnCamera:CutProjection={origin:[30,-40,80],axes:[[0,0,1],[0,1,0],[-1,0,0]]};
const corners=[[10,20],[110,20],[110,120],[10,120]];
const holeCorners=[[47.5,57.5],[47.5,82.5],[72.5,82.5],[72.5,57.5]];

/** The saved triangles, not the current source or a production projector,
 * independently prescribe a 100 x 100 mm rectangle on a 2,048-face grid.
 * Coordinates in the back reference frame map to negative world X. */
function fixture(view:'front'|'back'='front',hole=false,splitIslands=false,tJunction=false){
 const n=32,sign=view==='front'?1:-1,vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 for(let y=0;y<=n;y++)for(let x=0;x<=n;x++)vertices.push({id:randomUUID(),xMm:sign*(10+x*100/n),yMm:20+y*100/n,zMm:0});
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  if(hole&&x>=12&&x<20&&y>=12&&y<20||splitIslands&&x>=12&&x<20)continue;
  const a=y*(n+1)+x,b=a+1,c=a+n+1,d=c+1;
  for(const ids of [[a,b,d],[a,d,c]])faces.push({id:randomUUID(),vertices:ids.map(i=>vertices[i].id) as [string,string,string],region:'reference-sheet'});
 }
 const surface:Surface={id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces};
 const source:Piece={id:randomUUID(),name:'Live reference source',nodes:[[0,0],[100,0],[100,100],[0,100]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm})),closed:true,allowanceMm:0,cutQty:1,mirror:false,material:'Fur',furRad:0,color:'#2288cc'};
 if(hole)source.holes=[[[37.5,37.5],[37.5,62.5],[62.5,62.5],[62.5,37.5]].map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))];
 const fragments:Marking['fragments']=faces.map(f=>({faceId:f.id,rings:[[[1,0,0],[0,1,0],[0,0,1]]] as [number,number,number][][]}));
 // One side has a real midpoint station while the neighboring triangle's
 // coincident edge is unsplit. Both describe the same exact physical region.
 if(tJunction)fragments[0].rings=[[[1,0,0],[0,1,0],[.5,0,.5]],[[.5,0,.5],[0,1,0],[0,0,1]]];
 const original:Marking={id:randomUUID(),name:'Accepted reference projection',color:source.color,source:'reference',sourcePieceId:source.id,sourceHash:geometryHash(source),surfaceId:surface.id,surfaceHash:hash(surface),topologyVersion:1,view,offsetXmm:10,offsetYmm:20,editMode:'projected',fragments,paths:[]};
 const panel:Piece={...structuredClone(source),id:randomUUID(),name:'Accepted panel',nodes:corners.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm})),...(hole?{holes:[holeCorners.map(([xMm,yMm])=>({id:randomUUID(),xMm,yMm}))]}:{})};
 const boundary=[vertices[0].id,vertices[n].id,vertices.at(-1)!.id,vertices[n*(n+1)].id];
 const binding:SurfaceRun['bindings'][number]={pieceId:panel.id,surfaceId:surface.id,topologyVersion:1,geometryHash:geometryHash(panel),surfaceHash:hash(surface),report:{faceIds:faces.map(f=>f.id),uv:vertices.map(v=>({vertexId:v.id,xMm:sign*v.xMm,yMm:v.yMm})),boundary,areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,status:'acceptable'}};
 const run:SurfaceRun={sourceHash:hash(surface),algorithm:'lscm-cg-1',accepted:true,pieces:[panel],bindings:[binding]};
 const p:Project=project();p.pieces=[panel];p.surface=surface;p.bindings=[binding];p.surfaceRun=run;p.patternLibrary=[{piece:source,referenceId:randomUUID(),view,category:'reference'}];p.cuttingLibrary=[];
 let live=structuredClone(original);
 // Repeated acceptance stores the previous archived marking and then removes
 // the live source pointer, just as the actual repository transaction does.
 for(let depth=0;depth<3;depth++){
  const entry={id:randomUUID(),name:'Accepted version '+depth,createdAt:p.createdAt,sourceRevision:depth,surface:structuredClone(surface),run:structuredClone(run),markings:[structuredClone(live)],seams:[]};
  p.cuttingLibrary.push(entry);live={...live,source:'cut-library',cutLibraryId:entry.id,cutLibrarySourceHash:live.sourceHash,sourcePieceId:undefined};
 }
 p.activeCutId=p.cuttingLibrary.at(-1)!.id;p.markings=[live];
 return{p,surface,source,live};
}
function assertRing(actual:Shape['nodes'],expected:number[][]){
 expect(actual).toHaveLength(expected.length);
 for(const [x,y]of expected)expect(Math.min(...actual.map(p=>Math.hypot(p.xMm-x,p.yMm-y)))).toBeLessThan(1e-7);
}
function assertRectangle(shape:Shape,view:'front'|'back',hole=false){
 const sign=view==='front'?1:-1;
 expect(shape.origin).toEqual([0,0,0]);expect(shape.axes).toEqual([[sign,0,0],[0,1,0],[0,0,sign]]);
 assertRing(shape.nodes,corners);expect(shape.curves?.length??0).toBe(0);
 if(hole){expect(shape.holes).toHaveLength(1);assertRing(shape.holes![0],holeCorners);}else expect(shape.holes?.length??0).toBe(0);
 for(const node of shape.nodes){const world=shapeWorld(shape,node);expect(world.xMm).toBeCloseTo(sign*node.xMm,10);expect(world.yMm).toBeCloseTo(node.yMm,10);expect(world.zMm).toBe(0);}
}
function restore(f:ReturnType<typeof fixture>){
 expect(f.surface.faces.length).toBeGreaterThan(1000);expect(f.live.fragments.reduce((s,f)=>s+f.rings.reduce((n,r)=>n+r.length,0),0)).toBeGreaterThan(3000);
 const before=structuredClone(f.p),shape=editableShape(f.surface,f.live,edgeOnCamera,f.p);expect(f.p).toEqual(before);
 return shape;
}

it.each(['front','back'] as const)('accepted dense %s projection restores four physical corners even from an edge-on camera',view=>{
 const f=fixture(view);assertRectangle(restore(f),view);
});

it.each(['changed','deleted'] as const)('a %s current source cannot replace the accepted fragment outline',state=>{
 const f=fixture();
 if(state==='changed'){
  f.source.nodes[1].xMm=450;f.source.nodes[2].yMm=330;
  f.source.holes=[[{id:randomUUID(),xMm:1,yMm:1},{id:randomUUID(),xMm:1,yMm:9},{id:randomUUID(),xMm:9,yMm:9}]];
 }else f.p.patternLibrary=[];
 assertRectangle(restore(f),'front');
});

it('accepted source-manual fragments recover the same measured frame and boundary without consulting a missing source',()=>{
 const f=fixture('back');f.live.editMode='source-manual';f.p.patternLibrary=[];assertRectangle(restore(f),'back');
});

it.each(['missing-entry','missing-marking','hash-mismatch','cycle'] as const)('a multi-level %s archive chain cannot supply a different live-source contour',kind=>{
 const f=fixture(),entries=f.p.cuttingLibrary!;
 // A tempting, still-present live source deliberately disagrees with the
 // immutable fragment boundary. No chain may borrow this changed geometry.
 f.source.nodes[0].xMm=-900;f.source.nodes[1].xMm=900;
 if(kind==='missing-entry')entries.splice(0,1);
 if(kind==='missing-marking')entries[0].markings[0].id=randomUUID();
 if(kind==='hash-mismatch')entries[1].markings[0].cutLibrarySourceHash='0'.repeat(64);
 if(kind==='cycle')entries[0].markings[0]={...entries[0].markings[0],source:'cut-library',sourcePieceId:f.source.id,cutLibraryId:entries[2].id,cutLibrarySourceHash:f.live.sourceHash};
 assertRectangle(restore(f),'front');
});

it.each(['front','back'] as const)('saved dense %s fragments retain a real hole after the live source loses that hole',view=>{
 const f=fixture(view,true);f.source.holes=[];assertRectangle(restore(f),view,true);
});

it('unequal subdivision along an internal fragment edge cancels without leaving a seam or extra contour station',()=>{
 const f=fixture('front',false,false,true);assertRectangle(restore(f),'front');
});

it('a dense saved two-island projection is rejected instead of filled from the single-rectangle live source',()=>{
 const f=fixture('front',false,true),before=structuredClone(f.p);
 expect(f.surface.faces.length).toBeGreaterThan(1000);
 expect(()=>editableShape(f.surface,f.live,edgeOnCamera,f.p)).toThrow('MARKING_DISCONNECTED');expect(f.p).toEqual(before);
});

import {permittedAngles} from '../../../packages/manufacturing/material';
import {collide,type XY} from '../../../packages/nesting/contours';
import type {Project,Geometry,Nesting,NestingOptions,Piece,Point} from '../../../packages/schema/index';
import {nestingOptionsSchema,nestingSchema} from '../../../packages/schema/index';
import {DomainError,hash} from './repository';
import {assertOutputBudget} from '../../../packages/manufacturing/output-limits';
export const nestingHash=(project:Project)=>hash(JSON.stringify(project.materials?.length||project.defaultAllowanceMm!==undefined?{pieces:project.pieces,materials:project.materials??[],defaultAllowanceMm:project.defaultAllowanceMm??10}:project.pieces));
export function placedPoint(p:{xMm:number;yMm:number},placement:{xMm:number;yMm:number;angleRad:number;mirror:boolean},piece:Piece,geometry:Geometry){
 const cosine=Math.cos(placement.angleRad),sine=Math.sin(placement.angleRad);
 const rotate=(p:{xMm:number;yMm:number})=>{const x=placement.mirror?-p.xMm:p.xMm;return {xMm:x*cosine-p.yMm*sine,yMm:x*sine+p.yMm*cosine};};
 const ring=geometry.cut.map(rotate),minX=Math.min(...ring.map(n=>n.xMm)),minY=Math.min(...ring.map(n=>n.yMm)),r=rotate(p);
 return {xMm:r.xMm-minX+placement.xMm,yMm:r.yMm-minY+placement.yMm};
}
/** Conservative bounding rectangle packing. Holes are never used to place another instance. */
function nestShelf(project:Project,geometry:Geometry[],raw:NestingOptions):Nesting{
 const options=nestingOptionsSchema.parse(raw),{marginMm:m,gapMm:gap,widthMm:width,lengthLimitMm:limit}=options;
 if(project.pieces.reduce((n,p)=>n+p.cutQty,0)>10000)throw new DomainError('RESOURCE_LIMIT');
 if(width<=2*m||limit<=2*m)throw new DomainError('NESTING_BOUNDS');
 if(geometry.length!==project.pieces.length||geometry.some((g,i)=>g.id!==project.pieces[i].id||g.cut.length<3||g.issues.some(i=>i.severity==='error')))throw new DomainError('INVALID_GEOMETRY');
 const previous=project.nesting,hasLocks=options.preserveLocks!==false&&previous?.sheets.some(sheet=>sheet.placements.some(p=>p.locked));
 if(hasLocks){if(previous!.dependencyHash!==nestingHash(project))throw new DomainError('STALE_NESTING');validateNesting(project,geometry,previous!,false);}
 const result:Nesting={algorithm:hasLocks&&previous!.algorithm==='contour-bottom-left-1'?'contour-bottom-left-1':'shelf-bbox-1',dependencyHash:nestingHash(project),options,sheets:[],unplaced:[]};
 const groups=new Map<string,{piece:Piece;geometry:Geometry;instance:number;mirror:boolean;angle:number;w:number;h:number;area:number}[]>();
 for(const [i,piece] of project.pieces.entries()){
  const g=geometry[i],area=(r:Point[])=>Math.abs(r.reduce((a,p,j)=>{const q=r[(j+1)%r.length];return a+p.xMm*q.yMm-q.xMm*p.yMm;},0)/2),net=area(g.cut)-(g.cutHoles??[]).reduce((a,h)=>a+area(h),0);
  for(let instance=1;instance<=piece.cutQty;instance++){
   const mirror=piece.mirror&&instance%2===0,fur=mirror?Math.PI-piece.furRad:piece.furRad,angle=permittedAngles(project,piece,mirror,options)[0]??NaN,c=Math.cos(angle),s=Math.sin(angle),ring=g.cut.map(n=>{const x=mirror?-n.xMm:n.xMm;return {x:x*c-n.yMm*s,y:x*s+n.yMm*c};});
   const w=Math.max(...ring.map(n=>n.x))-Math.min(...ring.map(n=>n.x)),h=Math.max(...ring.map(n=>n.y))-Math.min(...ring.map(n=>n.y));
   if(!Number.isFinite(angle))throw new DomainError('GRAIN_VIOLATION');const items=groups.get(piece.material)??[];items.push({piece,geometry:g,instance,mirror,angle,w,h,area:net});groups.set(piece.material,items);
  }
 }
 for(const [material,items] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  items.sort((a,b)=>b.w*b.h-a.w*a.h||a.piece.id.localeCompare(b.piece.id)||a.instance-b.instance);
  const locked=hasLocks?previous!.sheets.filter(s=>s.material===material).flatMap(s=>s.placements.filter(p=>p.locked).map(p=>({...p}))):[];
  const shelves:{y:number;height:number;right:number}[]=[],placements:Nesting['sheets'][number]['placements']=locked;let end=m,totalArea=0;
  if(locked.length){   // Validate each preserved transform against the new bounds/grain settings before packing free instances.
   for(const p of locked){const item=items.find(i=>i.piece.id===p.pieceId&&i.instance===p.instance)!;if(!item)throw new DomainError('INVALID_NESTING');totalArea+=item.area;}
   // Full validation is performed after free placement; explicit checks avoid silently dropping an invalid lock.
   for(const p of locked){const piece=project.pieces.find(v=>v.id===p.pieceId)!;if(p.xMm<m-1e-6||p.yMm<m-1e-6||p.xMm+p.widthMm>width-m+1e-6||p.yMm+p.heightMm>limit-m+1e-6)throw new DomainError('NESTING_BOUNDS');if(!permittedAngles(project,piece,p.mirror,options).some(a=>Math.abs(Math.atan2(Math.sin(a-p.angleRad),Math.cos(a-p.angleRad)))<1e-6))throw new DomainError('GRAIN_VIOLATION');}
   end=Math.max(...locked.map(p=>p.yMm+p.heightMm));
  }
  for(const item of items){
   if(locked.some(p=>p.pieceId===item.piece.id&&p.instance===item.instance))continue;
   if(item.w>width-2*m+1e-8){result.unplaced.push({pieceId:item.piece.id,instance:item.instance,reason:'TOO_WIDE'});continue;}
   let shelf=shelves.find(s=>item.h<=s.height+1e-8&&s.right+gap+item.w<=width-m+1e-8);
   if(!shelf){const y=shelves.length||locked.length?end+gap:m;if(y+item.h>limit-m+1e-8){result.unplaced.push({pieceId:item.piece.id,instance:item.instance,reason:'LENGTH_LIMIT'});continue;}shelf={y,height:item.h,right:m-gap};shelves.push(shelf);end=y+item.h;}
   const x=shelf.right+gap;shelf.right=x+item.w;totalArea+=item.area;
   placements.push({pieceId:item.piece.id,instance:item.instance,xMm:x,yMm:shelf.y,angleRad:item.angle,mirror:item.mirror,widthMm:item.w,heightMm:item.h});
  }
  const lengthMm=placements.length?end+m:0;result.sheets.push({material,lengthMm,utilization:lengthMm?Math.min(1,totalArea/(width*lengthMm)):0,placements});
 }
 if(hasLocks&&!result.unplaced.length)validateNesting(project,geometry,result);
 return nestingSchema.parse(result);
}
export function validateNesting(project:Project,geometry:Geometry[],result:Nesting,requireComplete=true){
 nestingSchema.parse(result);const materials=new Set<string>();for(const sheet of result.sheets){if(materials.has(sheet.material))throw new DomainError('INVALID_NESTING');materials.add(sheet.material);}if(result.dependencyHash!==nestingHash(project))throw new DomainError('STALE_NESTING');if(requireComplete&&result.unplaced.length)throw new DomainError('UNPLACED_PIECES');
 const seen=new Set<string>(),m=result.options.marginMm,gap=result.options.gapMm;
 for(const sheet of result.sheets)for(const [i,p] of sheet.placements.entries()){
  const piece=project.pieces.find(piece=>piece.id===p.pieceId),g=geometry.find(g=>g.id===p.pieceId),key=`${p.pieceId}:${p.instance}`;
  if(!piece||!g||seen.has(key)||p.instance<1||p.instance>piece.cutQty||piece.material!==sheet.material||p.mirror!==(piece.mirror&&p.instance%2===0))throw new DomainError('INVALID_NESTING');seen.add(key);
  if(p.xMm<m-1e-6||p.yMm<m-1e-6||p.xMm+p.widthMm>result.options.widthMm-m+1e-6||p.yMm+p.heightMm>sheet.lengthMm-m+1e-6||sheet.lengthMm>result.options.lengthLimitMm+1e-6)throw new DomainError('NESTING_BOUNDS');
  const points=g.cut.map(n=>placedPoint(n,p,piece,g));if(Math.abs(Math.max(...points.map(n=>n.xMm))-Math.min(...points.map(n=>n.xMm))-p.widthMm)>1e-5||Math.abs(Math.max(...points.map(n=>n.yMm))-Math.min(...points.map(n=>n.yMm))-p.heightMm)>1e-5)throw new DomainError('INVALID_NESTING');
  if(!permittedAngles(project,piece,p.mirror,result.options).some(a=>Math.abs(Math.atan2(Math.sin(a-p.angleRad),Math.cos(a-p.angleRad)))<1e-6))throw new DomainError('GRAIN_VIOLATION');
  
  for(const q of sheet.placements.slice(i+1))if(result.algorithm==='contour-bottom-left-1'?collide(footprint(project,geometry,p),footprint(project,geometry,q),gap+.02):!(p.xMm+p.widthMm+gap<=q.xMm+1e-6||q.xMm+q.widthMm+gap<=p.xMm+1e-6||p.yMm+p.heightMm+gap<=q.yMm+1e-6||q.yMm+q.heightMm+gap<=p.yMm+1e-6))throw new DomainError('NESTING_COLLISION');
 }
 if(requireComplete&&seen.size!==project.pieces.reduce((n,p)=>n+p.cutQty,0))throw new DomainError('UNPLACED_PIECES');
}

/** Manual changes use authoritative cut bounds and recomputed sheet statistics, then the same manufacturing gate. */
export function normalizeManualNesting(project:Project,geometry:Geometry[],raw:Nesting):Nesting{
 const result=nestingSchema.parse(raw);
 if(geometry.length!==project.pieces.length||geometry.some((g,i)=>g.id!==project.pieces[i].id||g.cut.length<3||g.issues.some(v=>v.severity==='error')))throw new DomainError('INVALID_GEOMETRY');
 const materials=new Set<string>();
 for(const sheet of result.sheets){
  if(materials.has(sheet.material))throw new DomainError('INVALID_NESTING');materials.add(sheet.material);
  let area=0;const polygonArea=(r:Point[])=>Math.abs(r.reduce((sum,p,i)=>{const q=r[(i+1)%r.length];return sum+p.xMm*q.yMm-q.xMm*p.yMm;},0)/2);
  for(const p of sheet.placements){const piece=project.pieces.find(v=>v.id===p.pieceId),g=geometry.find(v=>v.id===p.pieceId);if(!piece||!g)throw new DomainError('INVALID_NESTING');
   const c=Math.cos(p.angleRad),s=Math.sin(p.angleRad),ring=g.cut.map(n=>{const x=p.mirror?-n.xMm:n.xMm;return {x:x*c-n.yMm*s,y:x*s+n.yMm*c};});
   p.widthMm=Math.max(...ring.map(n=>n.x))-Math.min(...ring.map(n=>n.x));p.heightMm=Math.max(...ring.map(n=>n.y))-Math.min(...ring.map(n=>n.y));
   area+=polygonArea(g.cut)-(g.cutHoles??[]).reduce((n,r)=>n+polygonArea(r),0);
  }
  sheet.lengthMm=sheet.placements.length?Math.max(...sheet.placements.map(p=>p.yMm+p.heightMm))+result.options.marginMm:0;
  sheet.utilization=sheet.lengthMm?Math.min(1,area/(result.options.widthMm*sheet.lengthMm)):0;
 }
 validateNesting(project,geometry,result);return result;
}

type Placement=Nesting['sheets'][number]['placements'][number];
function footprint(project:Project,geometry:Geometry[],p:Placement):XY[]{const piece=project.pieces.find(v=>v.id===p.pieceId)!,g=geometry.find(v=>v.id===p.pieceId)!;return g.cut.map(n=>{const v=placedPoint(n,p,piece,g);return {x:v.xMm,y:v.yMm};});}
export function nest(project:Project,geometry:Geometry[],raw:NestingOptions):Nesting{
 if(!project.pieces.length)throw new DomainError('EMPTY_PROJECT');
 try{assertOutputBudget(project,geometry);}catch(error){throw new DomainError((error as Error).message);}
 const options=nestingOptionsSchema.parse(raw);if(options.mode!=='contour')return nestShelf(project,geometry,options);
 const baseline=nestShelf(project,geometry,options),clearance=options.gapMm+.02,m=options.marginMm,budget=options.candidateBudget??2000;
 const attempt=(reverse:boolean):Nesting=>{
 const result:Nesting={algorithm:'contour-bottom-left-1',dependencyHash:nestingHash(project),options,sheets:[],unplaced:[]};
 for(const base of baseline.sheets){
 const placements:Placement[]=base.placements.filter(p=>p.locked).map(p=>({...p})),rings=placements.map(p=>footprint(project,geometry,p));let checked=0;
 const items=project.pieces.filter(p=>p.material===base.material).flatMap(piece=>Array.from({length:piece.cutQty},(_,i)=>({piece,instance:i+1}))).sort((a,b)=>{const ga=geometry.find(g=>g.id===a.piece.id)!,gb=geometry.find(g=>g.id===b.piece.id)!;return (reverse?gb.perimeterMm-ga.perimeterMm:gb.areaMm2-ga.areaMm2)||a.piece.id.localeCompare(b.piece.id)||a.instance-b.instance;});
 for(const {piece,instance} of items){if(placements.some(p=>p.pieceId===piece.id&&p.instance===instance))continue;
 const g=geometry.find(v=>v.id===piece.id)!,mirror=piece.mirror&&instance%2===0,angles=permittedAngles(project,piece,mirror,options);let best:Placement|undefined,bestRing:XY[]|undefined;
 for(const angleRad of angles){const provisional:Placement={pieceId:piece.id,instance,mirror,angleRad,xMm:0,yMm:0,widthMm:1,heightMm:1},local=footprint(project,geometry,provisional);provisional.widthMm=Math.max(...local.map(p=>p.x));provisional.heightMm=Math.max(...local.map(p=>p.y));if(provisional.widthMm>options.widthMm-2*m+1e-7)continue;
 const xs=new Set<number>([m]),ys=new Set<number>([m]);
 for(const ring of rings){const maxX=Math.max(...ring.map(p=>p.x)),maxY=Math.max(...ring.map(p=>p.y));xs.add(maxX+clearance);ys.add(maxY+clearance);
 // Vertex alignments expose concave pockets that bounding rectangles cannot use.
 const sample=(r:XY[])=>r.filter((_,i)=>i%Math.max(1,Math.ceil(r.length/24))===0);
 for(const a of sample(ring))for(const b of sample(local)){const x=a.x-b.x+clearance,y=a.y-b.y+clearance;if(x>=m)xs.add(x);if(y>=m)ys.add(y);}
 }
 const sortedX=[...xs].filter(x=>x+provisional.widthMm<=options.widthMm-m+1e-7).sort((a,b)=>a-b),sortedY=[...ys].filter(y=>y+provisional.heightMm<=options.lengthLimitMm-m+1e-7).sort((a,b)=>a-b);
 let itemChecks=0;
 for(const y of sortedY){for(const x of sortedX){if(itemChecks++>=budget||checked++>=Math.min(100000,budget*items.length))break;const p={...provisional,xMm:x,yMm:y},ring=local.map(v=>({x:v.x+x,y:v.y+y}));if(rings.some(r=>collide(ring,r,clearance)))continue;if(!best||y+p.heightMm<best.yMm+best.heightMm-1e-7||Math.abs(y+p.heightMm-best.yMm-best.heightMm)<1e-7&&x<best.xMm){best=p;bestRing=ring;}break;}if(itemChecks>=budget)break;}
 }
 if(best&&bestRing){placements.push(best);rings.push(bestRing);}else result.unplaced.push({pieceId:piece.id,instance,reason:'NO_FEASIBLE_POSITION_WITHIN_BUDGET'});
 }
 const lengthMm=placements.length?Math.max(...placements.map(p=>p.yMm+p.heightMm))+m:0;const area=placements.reduce((sum,p)=>{const g=geometry.find(v=>v.id===p.pieceId)!,area=(r:Point[])=>Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2);return sum+area(g.cut)-(g.cutHoles??[]).reduce((s,r)=>s+area(r),0);},0);
 result.sheets.push({material:base.material,lengthMm,utilization:lengthMm?Math.min(1,area/(options.widthMm*lengthMm)):0,placements});
 }
 if(!result.unplaced.length)validateNesting(project,geometry,result);return result;
 };
 // A validated rectangle baseline remains available: heuristic attempts cannot replace a better feasible layout.
 const score=(n:Nesting)=>[n.unplaced.length,n.sheets.reduce((s,v)=>s+v.lengthMm,0)];
 const choices=[baseline];for(const reverse of [false,true]){try{choices.push(attempt(reverse));}catch(e){if(!(e instanceof DomainError)||e.code!=='NESTING_COLLISION')throw e;}}choices.sort((a,b)=>score(a)[0]-score(b)[0]||score(a)[1]-score(b)[1]);return nestingSchema.parse(choices[0]);
}

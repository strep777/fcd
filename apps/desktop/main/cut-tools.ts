import {randomUUID} from 'node:crypto';
import {cutLineSchema,surfaceSchema,type Command,type CutLine,type Surface,type Project,type CutProjection,type SurfaceRun} from '../../../packages/schema/index';
import {mapToSurface} from '../../../packages/surface/mapping';
import {edgeKey,refineSurface,type FaceCut} from '../../../packages/surface/refine';
import {planeSegments,projectedCurveSegments,scopeFaces} from '../../../packages/surface/cut-geometry';
import {remapRefinedMarkings} from './cut-points';
import {markingFingerprint} from './markings';
import {validateSurface} from './surface';
import {DomainError} from './repository';
type CutCommand=Extract<Command,{type:'surface.curve'|'surface.section'|'surface.cutScope'|'surface.cutLine.meta'|'surface.cutLine.delete'}>;
export function cutComponents(edges:{a:string;b:string}[]){
 const neighbors=new Map<string,Set<string>>();for(const e of edges){for(const [a,b] of [[e.a,e.b],[e.b,e.a]]){const list=neighbors.get(a)??new Set<string>();list.add(b);neighbors.set(a,list);}}
 const seen=new Set<string>(),result:{a:string;b:string}[][]=[];for(const start of neighbors.keys()){if(seen.has(start))continue;const queue=[start],group=new Set<string>();while(queue.length){const id=queue.pop()!;if(group.has(id))continue;group.add(id);seen.add(id);queue.push(...neighbors.get(id)!);}result.push(edges.filter(e=>group.has(e.a)));}return result;
}
export function derivedCuts(surface:Surface){const edges=new Map((surface.cutBaseConstraints??[]).map(c=>[edgeKey(c.a,c.b),c]));for(const line of surface.cutLines??[])if(line.enabled)for(const edge of line.edges)edges.set(edgeKey(edge.a,edge.b),{...edge,locked:true});return [...edges.values()];}
/** Keep legacy manual cuts independent from saved curve groups. */
export function normalizeCutSurface(surface:Surface,previous?:Surface){
 if(!surface.cutLines)return surface;const grouped=new Set(surface.cutLines.flatMap(line=>line.edges.map(e=>edgeKey(e.a,e.b)))),base=new Map((surface.cutBaseConstraints??previous?.cutBaseConstraints??[]).map(e=>[edgeKey(e.a,e.b),e])),actual=new Set((surface.cutConstraints??[]).map(e=>edgeKey(e.a,e.b)));
 for(const [key] of base)if(!actual.has(key))base.delete(key);for(const edge of surface.cutConstraints??[])if(!grouped.has(edgeKey(edge.a,edge.b)))base.set(edgeKey(edge.a,edge.b),edge);const result={...surface,cutBaseConstraints:[...base.values()]};return {...result,cutConstraints:derivedCuts(result)};
}
export async function editSurfaceCuts(worker:string,project:Project,command:CutCommand){
 const original=project.surface;if(!original)throw new DomainError('SURFACE_MISSING');validateSurface(original);
 const surface=structuredClone(original);surface.cutBaseConstraints??=(surface.cutConstraints??[]).filter(c=>!surface.cutLines?.some(l=>l.edges.some(e=>edgeKey(e.a,e.b)===edgeKey(c.a,c.b))));surface.cutLines??=[];
 let lines=[...surface.cutLines],cuts:FaceCut[]=[],replacing:string[]=[],created:CutLine[]=[];
 const resolveLine=(id:string)=>{const line=lines.find(l=>l.id===id);if(!line)throw new DomainError('ENTITY_MISSING');return line.mirroredFrom?lines.find(l=>l.id===line.mirroredFrom)!:line;};
 const replace=(id?:string)=>{if(!id)return randomUUID();const previous=resolveLine(id);if(previous.kind==='midline'&&surface.cutScope?.side!=='full')throw new DomainError('MIDLINE_SCOPE_ACTIVE');replacing=[previous.id,...lines.filter(l=>l.mirroredFrom===previous.id).map(l=>l.id)];return previous.id;};
 try{
  if(command.type==='surface.cutLine.delete'){const previous=resolveLine(command.lineId);if(previous.kind==='midline'&&surface.cutScope?.side!=='full')throw new DomainError('MIDLINE_SCOPE_ACTIVE');lines=lines.filter(l=>l.id!==previous.id&&l.mirroredFrom!==previous.id);}
  else if(command.type==='surface.cutLine.meta'){const previous=resolveLine(command.lineId);lines=lines.map(l=>l.id===previous.id?{...l,name:command.name.trim(),enabled:command.enabled}:l.mirroredFrom===previous.id?{...l,name:(command.name.trim()+' · 对称').slice(0,120),enabled:command.enabled}:l);}
  else if(command.type==='surface.curve'){
   const id=replace(command.id),line:CutLine={id,name:command.name.trim(),kind:command.kind,enabled:true,closed:command.closed,symmetric:command.symmetric,regions:command.regions,controlPoints:command.controlPoints,projection:command.projection,tension:command.tension,edges:[]};created.push(line);
   cuts.push(...projectedCurveSegments(surface,line.controlPoints,line.projection!,line.tension,line.closed,line.kind as 'pen'|'freehand',id,line.regions));
   if(command.symmetric){const mirrorId=surface.cutLines.find(l=>l.mirroredFrom===id)?.id??randomUUID(),axis=surface.cutScope?.axis??'x',plane=surface.cutScope?.positionMm??0,index={x:0,y:1,z:2}[axis],key=(axis+'Mm') as 'xMm'|'yMm'|'zMm',points=line.controlPoints.map(p=>({...p,id:randomUUID(),[key]:2*plane-p[key]})),projection:CutProjection={origin:line.projection!.origin.map((n,i)=>i===index?2*plane-n:n) as [number,number,number],axes:line.projection!.axes.map(a=>a.map((n,i)=>i===index?-n:n)) as CutProjection['axes']},mirror={...line,id:mirrorId,name:(line.name+' · 对称').slice(0,120),mirroredFrom:id,symmetric:false,controlPoints:points,projection};created.push(mirror);cuts.push(...projectedCurveSegments(surface,points,projection,line.tension,line.closed,line.kind as 'pen'|'freehand',mirrorId,line.regions));}
  }else if(command.type==='surface.section'){
   const id=replace(command.id);created.push({id,name:command.name.trim(),kind:'section',enabled:true,closed:true,symmetric:false,controlPoints:[],tension:1,section:command.section,edges:[]});cuts=planeSegments(surface,command.section.axis,command.section.positionMm,id,command.section.regions);
  }else if(command.type==='surface.cutScope'){
   surface.cutScope=command.scope;if(command.scope.side!=='full'){replacing=lines.filter(l=>l.kind==='midline').map(l=>l.id);cuts=planeSegments(surface,command.scope.axis,command.scope.positionMm,'midline');}
  }
  if(command.type==='surface.cutLine.meta'||command.type==='surface.cutLine.delete'){
   const next=surfaceSchema.parse({...surface,cutLines:lines,cutConstraints:derivedCuts({...surface,cutLines:lines})});validateSurface(next);
   const unchanged=JSON.stringify(next.cutConstraints)===JSON.stringify(original.cutConstraints),markings=await remapRefinedMarkings(worker,project,next,new Map());
   if(unchanged){for(const m of markings)m.paths=project.markings?.find(old=>old.id===m.id)?.paths??[];for(const m of markings)if(m.inference){const parent=markings.find(source=>source.id===m.inference!.sourceMarkingId);if(parent)m.inference.sourceFingerprint=markingFingerprint(parent);}}
   return {surface:next,markings};
  }
  const refined=refineSurface(surface,cuts,randomUUID);lines=(refined.surface.cutLines??[]).filter(l=>!replacing.includes(l.id));
  for(const line of created){line.edges=[...new Map((refined.owned.get(line.id)??[]).map(e=>[edgeKey(e.a,e.b),e])).values()];if(!line.edges.length)throw Error('INVALID_CUT');if(line.kind==='section'){const counts=new Map<string,number>();for(const e of line.edges)for(const id of [e.a,e.b])counts.set(id,(counts.get(id)??0)+1);line.closed=[...counts.values()].every(n=>n===2);}lines.push(cutLineSchema.parse(line));}
  if(command.type==='surface.cutScope'&&command.scope.side!=='full')for(const [i,edges] of cutComponents([...new Map((refined.owned.get('midline')??[]).map(e=>[edgeKey(e.a,e.b),e])).values()]).entries()){const old=surface.cutLines.filter(l=>l.kind==='midline')[i];lines.push({id:old?.id??randomUUID(),name:old?.name??('中线边界 '+(i+1)),kind:'midline',enabled:command.scope.closeMidline,closed:false,symmetric:false,controlPoints:[],tension:1,section:{axis:command.scope.axis,positionMm:command.scope.positionMm},edges});}
  const next=surfaceSchema.parse({...refined.surface,cutLines:lines,cutConstraints:derivedCuts({...refined.surface,cutLines:lines})});validateSurface(next);if(next.cutScope&&next.cutScope.side!=='full'&&!scopeFaces(next).length)throw new DomainError('EMPTY_CUT_SCOPE');const markings=await remapRefinedMarkings(worker,project,next,refined.children);return {surface:next,markings};
 }catch(error){if(error instanceof DomainError)throw error;throw new DomainError((error as Error).message);}
}
/** Half-side cuts print paired mirror copies; pieces along an unlocked midline are cut on the fold. */
export function applyHalfCutScope(surface:Surface,run:SurfaceRun){
 const scope=surface.cutScope;if(!scope||scope.side==='full')return run;const key=(scope.axis+'Mm') as 'xMm'|'yMm'|'zMm',vertices=new Map(surface.vertices.map(v=>[v.id,v])),midlines=surface.cutLines?.filter(l=>l.kind==='midline')??[],sewnEdges=midlines.filter(l=>l.enabled).flatMap(l=>l.edges.map(e=>[vertices.get(e.a)!,vertices.get(e.b)!] as const));
 const sewn=(p:{xMm:number;yMm:number;zMm:number})=>sewnEdges.some(([a,b])=>{const d=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],length=d.reduce((n,x)=>n+x*x,0),t=Math.max(0,Math.min(1,((p.xMm-a.xMm)*d[0]+(p.yMm-a.yMm)*d[1]+(p.zMm-a.zMm)*d[2])/length));return Math.hypot(p.xMm-a.xMm-t*d[0],p.yMm-a.yMm-t*d[1],p.zMm-a.zMm-t*d[2])<1e-5;});
 for(const piece of run.pieces){const binding=run.bindings.find(b=>b.pieceId===piece.id);if(!binding)throw new DomainError('STALE_BINDING');
  const folds=piece.nodes.flatMap((a,i)=>{const b=piece.nodes[(i+1)%piece.nodes.length],pa=mapToSurface(surface,binding,a),pb=mapToSurface(surface,binding,b);return pa&&pb&&Math.abs(pa.position[key]-scope.positionMm)<1e-5&&Math.abs(pb.position[key]-scope.positionMm)<1e-5&&(midlines.length?!sewn({xMm:(pa.position.xMm+pb.position.xMm)/2,yMm:(pa.position.yMm+pb.position.yMm)/2,zMm:(pa.position.zMm+pb.position.zMm)/2}):!scope.closeMidline)?[{nodeId:a.id,endNodeId:b.id,samples:[{s:0,widthMm:0},{s:1,widthMm:0}]}]:[];});
  const fold=folds.length>0;piece.cutQty=fold?1:2;piece.mirror=!fold;piece.name=((scope.side==='right'?'右侧 · ':'左侧 · ')+piece.name+(fold?' · 中线对折':'')).slice(0,120);
  if(fold)piece.edgeAllowances=[...(piece.edgeAllowances??[]).filter(e=>!folds.some(f=>f.nodeId===e.nodeId&&f.endNodeId===e.endNodeId)),...folds];
 }return {...run,scope};
}

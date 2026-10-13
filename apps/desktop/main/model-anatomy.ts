import {bodyRegions} from '../../../packages/surface/body-regions';
import {surfaceSchema,type Surface,type Project,type Command} from '../../../packages/schema/index';
import {namedPart,type BodySide} from '../../../packages/reference/body-parts';
import {DomainError,hash} from './repository';
import {bindingIssues,cutColorHash} from './surface';
import {staleMarkingIds} from './markings';

/** Classification changes metadata, never the geometry of a saved mapping. */
export function applyModelAnatomy(project:Project,command:Extract<Command,{type:'surface.anatomy'}>){
 const surface=project.surface;if(!surface)throw new DomainError('SURFACE_MISSING');
 const stale=staleMarkingIds(project),invalidBindings=new Set(bindingIssues(project).filter(i=>i.severity==='error').map(i=>i.entityId));
 const validBindings=new Set(project.bindings?.filter(b=>!invalidBindings.has(b.pieceId)&&project.pieces.some(p=>p.id===b.pieceId)).map(b=>b.pieceId));
 const names=new Map(command.faceRegions?.map(f=>[f.faceId,f.region]));
 project.surface=surfaceSchema.parse({...surface,faces:surface.faces.map(f=>({...f,region:names.get(f.id)??f.region})),partAssignments:command.assignments});
 const digest=hash(JSON.stringify(project.surface));
 for(const m of project.markings??[]){
  if(!stale.has(m.id))m.surfaceHash=digest;
  if(m.placement)m.placement.reviewed=false;
 }
 const colors=cutColorHash(project);
 for(const b of project.bindings??[])if(validBindings.has(b.pieceId)){b.surfaceHash=digest;if(b.colorHash)b.colorHash=colors;}
 project.surfaceRun=undefined;project.previewMarkings=undefined;
}
export function classifyModel(mesh:Surface,kind:'body'|'body-feet'|'head'|'paw'|'foot',footBoundaryMm?:number,requestedSide:BodySide='unknown'){
 let minY=Infinity,maxY=-Infinity;for(const v of mesh.vertices){minY=Math.min(minY,v.yMm);maxY=Math.max(maxY,v.yMm);}const boundary=footBoundaryMm??minY+(maxY-minY)*.15;
 if(kind==='body-feet'&&(!Number.isFinite(boundary)||boundary<=minY||boundary>=maxY))throw new DomainError('INVALID_CALIBRATION');
 const hints=bodyRegions(mesh,minY,maxY);const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),faceRegions:{faceId:string;region:string}[]=[],assignments=new Map<string,{region:string;part:ReturnType<typeof namedPart>['part'];side:ReturnType<typeof namedPart>['side']}>();
 for(const face of mesh.faces){const existing=mesh.partAssignments?.find(a=>a.region===face.region)??namedPart(face.region);const body=kind==='body'||kind==='body-feet';if(existing.part!=='unknown'&&!(body&&existing.part==='body')){assignments.set(face.region,{region:face.region,...existing});continue;}const triangle=face.vertices.map(id=>vertices.get(id)!),x=triangle.reduce((s,v)=>s+v.xMm/3,0),y=triangle.reduce((s,v)=>s+v.yMm/3,0),t=(y-minY)/(maxY-minY),foot=kind==='body-feet'&&y<boundary,arm=body&&hints.arm&&t>.55&&Math.abs(x-hints.centerX)>hints.halfWidth*1.05,leg=body&&hints.leg&&t<.48;const part=foot?'foot':arm?'arm':leg?'leg':body?'body':kind,side=foot||arm||leg?(x<hints.centerX?'left':'right'):kind==='paw'||kind==='foot'?requestedSide:'center',region=body&&(foot||arm||leg||hints.arm||hints.leg)?`${face.region.slice(0,50)} / ${part}-${side}`:face.region;faceRegions.push({faceId:face.id,region});assignments.set(region,{region,part,side});}
 if(assignments.size>500)throw new DomainError('RESOURCE_LIMIT');return {assignments:[...assignments.values()],faceRegions};
}

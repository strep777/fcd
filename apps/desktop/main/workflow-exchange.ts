import {svgPrintPlan,selectedPrintPages,printPageSvg} from '../../../packages/manufacturing/print-pages';
import {zipSync,strToU8,Unzip,type AsyncFlateStreamHandler,type UnzipDecoder} from 'fflate';
import {inflateRawSync} from 'node:zlib';
import type {Geometry,Paper,Project} from '../../../packages/schema/index';
import {workflowFileSchema} from '../../../packages/schema/index';
import {pack,unpack} from './archive';
import {svgExport,gate} from './export';
import {markingFingerprint} from './markings';
import {DomainError,hash} from './repository';
import {assertOutputBudget} from '../../../packages/manufacturing/output-limits';

export const workflowBytes=(project:Project)=>strToU8(JSON.stringify(workflowFileSchema.parse({format:'fpcad-workflow',version:1,project}),null,2));
export function readWorkflow(bytes:Uint8Array){if(bytes.length>200*1024*1024)throw new DomainError('RESOURCE_LIMIT');return workflowFileSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))).project;}

export function selectedProject(project:Project,ids:string[]):Project{
 const chosen=new Set(ids);if(chosen.size!==ids.length||!ids.length||ids.some(id=>!project.pieces.some(p=>p.id===id)))throw new DomainError('ENTITY_MISSING');
 const markings=project.markings?.map(m=>({...m,inference:m.inference?{...m.inference}:undefined,paths:m.paths.filter(p=>chosen.has(p.pieceId))}));
 for(const marking of markings??[])if(marking.inference){const parent=markings?.find(m=>m.id===marking.inference!.sourceMarkingId);if(parent)marking.inference.sourceFingerprint=markingFingerprint(parent);}
 const sources=project.pieces.filter(p=>!chosen.has(p.id)&&markings?.some(m=>m.sourcePieceId===p.id));
 return {...project,pieces:project.pieces.filter(p=>chosen.has(p.id)).map(p=>({...p,notches:p.notches?.map(({sourceSeamId,...n})=>n)})),bindings:project.bindings?.filter(b=>chosen.has(b.pieceId)),markings,seams:[],nesting:undefined,
  patternLibrary:[...(project.patternLibrary??[]),...sources.map(piece=>({piece,view:'front' as const,referenceId:project.id,category:'Legacy source'}))]};
}

/** Editable project plus a separate SVG preview for each cut, all with verified hashes. */
export function cutBundle(project:Project,geometry:Geometry[]){
 const files:Record<string,Uint8Array>={'project.fpcad':pack(project).bytes};
 const valid=geometry.every(g=>!g.issues.some(i=>i.severity==='error'));
 const ack=geometry.flatMap(g=>g.issues.filter(i=>i.severity==='warning').map(i=>i.ruleId));
 let previews=false;
 if(valid){try{gate(project,geometry,ack);assertOutputBudget(project,geometry);previews=true;}catch{/* Editable bundles also preserve drafts that are not ready to manufacture. */}}
 if(previews)for(const piece of project.pieces){const subset=selectedProject(project,[piece.id]);files[`pieces/${piece.id}.svg`]=strToU8(svgExport(subset,geometry.filter(g=>g.id===piece.id),ack));}
 files['catalog.json']=strToU8(JSON.stringify({format:'fpcad-cuts',version:1,projectId:project.id,revision:project.revision,previews,pieces:project.pieces.map(p=>({id:p.id,name:p.name,color:p.color,cutQty:p.cutQty})),files:Object.entries(files).map(([path,bytes])=>({path,size:bytes.length,sha256:hash(bytes)}))}));
 const total=Object.values(files).reduce((sum,b)=>sum+b.length,0);if(total>200*1024*1024)throw new DomainError('RESOURCE_LIMIT');
 return zipSync(files,{level:0});
}
class BoundedInflate implements UnzipDecoder{
 static compression=8;ondata!:AsyncFlateStreamHandler;private chunks:Uint8Array[]=[];
 push(bytes:Uint8Array,final:boolean){this.chunks.push(bytes);if(final){let output:Buffer;try{output=inflateRawSync(Buffer.concat(this.chunks),{maxOutputLength:200*1024*1024});}catch{throw new DomainError('INVALID_ARCHIVE');}this.chunks=[];this.ondata(null,Uint8Array.from(output),true);}}
}
export function readCutBundle(bytes:Uint8Array){
 const limit=200*1024*1024;if(bytes.length>limit)throw new DomainError('RESOURCE_LIMIT');
 const files=new Map<string,Uint8Array>(),seen=new Set<string>();let total=0;
 const unzip=new Unzip(file=>{
  if(seen.size>=502||seen.has(file.name.toLowerCase())||!/^project\.fpcad$|^catalog\.json$|^pieces\/[0-9a-f-]{36}\.svg$/i.test(file.name))throw new DomainError('UNSAFE_ARCHIVE');
  seen.add(file.name.toLowerCase());if((file.originalSize??0)>limit)throw new DomainError('RESOURCE_LIMIT');
  const chunks:Uint8Array[]=[];
  file.ondata=(error,data,final)=>{if(error)throw new DomainError('INVALID_ARCHIVE');total+=data.length;if(total>limit)throw new DomainError('RESOURCE_LIMIT');chunks.push(data);if(final)files.set(file.name,Buffer.concat(chunks));};file.start();
 });unzip.register(BoundedInflate);unzip.push(bytes,true);
 const data=files.get('project.fpcad'),catalog=files.get('catalog.json');if(!data||!catalog)throw new DomainError('MISSING_FILE');
 const meta=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(catalog));
 if(meta.format!=='fpcad-cuts'||meta.version!==1||!Array.isArray(meta.files)||meta.files.length!==files.size-1||new Set(meta.files.map((v:{path:string})=>v.path)).size!==meta.files.length)throw new DomainError('INVALID_ARCHIVE');
 for(const entry of meta.files){const value=files.get(entry.path);if(entry.path==='catalog.json'||!value||value.length!==entry.size||hash(value)!==entry.sha256)throw new DomainError('HASH_MISMATCH');}
 const project=unpack(data);if(project.id!==meta.projectId||project.revision!==meta.revision)throw new DomainError('HASH_MISMATCH');return project;
}

export function printHtml(svg:string,paper:Paper,pageNumbers?:number[]){
 let plan,pages;try{plan=svgPrintPlan(svg,paper);pages=selectedPrintPages(plan,pageNumbers);}catch(error){throw new DomainError((error as Error).message);}
 return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${paper.widthMm}mm ${paper.heightMm}mm;margin:0}*{box-sizing:border-box}body{margin:0}.sheet{width:${paper.widthMm}mm;height:${paper.heightMm}mm;break-after:page;overflow:hidden;print-color-adjust:exact;-webkit-print-color-adjust:exact}.sheet:last-child{break-after:auto}svg{display:block}</style></head><body>${pages.map(page=>`<section class="sheet" data-page="${page.number}">${printPageSvg(svg,plan,page)}</section>`).join('')}</body></html>`;
}

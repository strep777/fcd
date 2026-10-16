import {randomUUID} from 'node:crypto';
import type {Project,CutLibraryEntry,Marking} from '../../../packages/schema/index';
import {cutLibraryEntrySchema} from '../../../packages/schema/index';
import {DomainError,hash} from './repository';
import {cutColorHash,pieceGeometryHash} from './surface';
import {assertModelDetach} from './project-lifecycle';

/** Legacy drafts need human approval against their immutable snapshot, never a
 * missing live flower source or a changed model/classification. */
export function archivedPlacementMatches(project:Project,marking:Marking):boolean {
 if(marking.source!=='cut-library'||!marking.placement||!project.surface)return false;
 const entry=project.cuttingLibrary?.find(e=>e.id===marking.cutLibraryId),original=entry?.markings.find(m=>m.id===marking.id);
 if(!entry||!original?.placement||original.sourceHash!==(marking.cutLibrarySourceHash??marking.sourceHash))return false;
 const digest=hash(JSON.stringify(entry.surface));
 if(entry.run.sourceHash!==digest||original.surfaceHash!==digest||hash(JSON.stringify(project.surface))!==digest||marking.surfaceHash!==digest||marking.surfaceId!==entry.surface.id||marking.topologyVersion!==entry.surface.topologyVersion)return false;
 const metadata=(m:Marking)=>{const {reviewed,...placement}=m.placement!;return {placement,fragments:m.fragments,paths:m.paths,color:m.color,view:m.view,sourceHash:m.sourceHash,surfaceShape:m.surfaceShape};};
 if(JSON.stringify(metadata(marking))!==JSON.stringify(metadata(original)))return false;
 return marking.paths.every(path=>{const piece=project.pieces.find(p=>p.id===path.pieceId);return !!piece&&path.geometryHash===pieceGeometryHash(piece);});
}

export function archiveCut(project:Project):CutLibraryEntry {
 if(!project.surface||!project.surfaceRun?.accepted)throw new DomainError('STALE_RESULT');
 if((project.cuttingLibrary?.length??0)>=100)throw new DomainError('CUT_LIBRARY_LIMIT');
 const run=project.surfaceRun,ids=new Set(run.pieces.map(p=>p.id));
 return cutLibraryEntrySchema.parse(structuredClone({id:randomUUID(),name:`${project.name} · ${new Date().toISOString().slice(0,19).replace('T',' ')} · R${project.revision+1}`.slice(0,120),createdAt:new Date().toISOString(),sourceRevision:project.revision,surface:project.surface,run,markings:project.markings??[],seams:project.seams?.filter(s=>ids.has(s.a.pieceId)&&ids.has(s.b.pieceId))??[]}));
}

/** Load approved manufacturing geometry with its physical model. Original flower
 * sources are independent; historical output never overwrites current sources. */
export function activateCut(project:Project,entryId:string):void {
 const stored=project.cuttingLibrary?.find(e=>e.id===entryId);
 if(!stored)throw new DomainError('ENTITY_MISSING');
 const entry=structuredClone(stored),digest=hash(JSON.stringify(entry.surface));
 if(entry.run.sourceHash!==digest||entry.run.bindings.some(b=>b.surfaceHash!==digest||b.geometryHash!==pieceGeometryHash(entry.run.pieces.find(p=>p.id===b.pieceId)!))||entry.markings.some(m=>m.surfaceHash!==digest))throw new DomainError('STALE_RESULT');
 const removed=new Set(project.bindings?.map(b=>b.pieceId));assertModelDetach(project,removed);
 project.pieces=project.pieces.filter(p=>!removed.has(p.id)&&!entry.run.pieces.some(c=>c.id===p.id));
 project.pieces.push(...entry.run.pieces);project.bindings=entry.run.bindings;
 project.surface=entry.surface;project.surfaceRun=entry.run;
 project.markings=entry.markings.map(m=>({...m,source:'cut-library',cutLibraryId:entry.id,cutLibrarySourceHash:m.sourceHash,sourcePieceId:undefined}));
 // Removing a live source reference does not alter fragments or their color hash.
 const colors=cutColorHash(project);for(const b of project.bindings)if(b.colorHash)b.colorHash=colors;
 project.seams=[...(project.seams??[]).filter(s=>!removed.has(s.a.pieceId)&&!removed.has(s.b.pieceId)),...entry.seams];
 project.previewMarkings=undefined;project.nesting=undefined;project.activeCutId=entry.id;
}

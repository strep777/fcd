import type {Project,Marking} from '../../../packages/schema/index';
import {pairedPalette} from '../../../packages/reference/paired-palette';
import {pigmentFamily} from '../../../packages/reference/illustration';

/** Interpret the two automatic views as cloth materials without rewriting
 * either source artwork or saved attachments. Manual/custom colors remain
 * independent. Unpainted space uses the unambiguous white reference fabric. */
export function designMaterials(project:Project){
 const references=new Map((project.references??[]).filter(r=>r.illustration?.algorithm==='illustration-2').map(r=>[r.id,r])),sources=new Map((project.patternLibrary??[]).map(r=>[r.piece.id,r]));
 const front=[...references.values()].find(r=>r.view==='front')?.illustration?.palette??[],back=[...references.values()].find(r=>r.view==='back')?.illustration?.palette??[],palette=pairedPalette(front,back);
 const white=(colors:string[])=>[...new Set(colors.map(c=>palette.get(c)??c))].filter(c=>pigmentFamily(c)===0&&Math.min(...[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)))>=153),frontWhite=white(front),backWhite=white(back);
 const archived=project.activeCutId?project.cuttingLibrary?.find(e=>e.id===project.activeCutId):undefined;
 const sheetWhite=white([...references.values()].filter(r=>r.view==='sheet').flatMap(r=>r.illustration?.palette??[]));
 const baseColor=archived?.run.materialPalette?.baseColor??(sheetWhite.length===1?sheetWhite[0]:frontWhite.length===1&&backWhite.length===1&&frontWhite[0]===backWhite[0]?frontWhite[0]:'#eceae5');
 const color=(marking:Marking)=>{
  if(marking.source==='cut-library'){
   const entry=project.cuttingLibrary?.find(e=>e.id===marking.cutLibraryId),original=entry?.markings.find(m=>m.id===marking.id);
   if(original?.color===marking.color&&original.sourceHash===(marking.cutLibrarySourceHash??marking.sourceHash))return entry?.run.materialPalette?.markings.find(m=>m.markingId===marking.id)?.color??marking.color;
   return marking.color;
  }
  const source=marking.sourcePieceId?sources.get(marking.sourcePieceId):undefined,reference=source?references.get(source.referenceId):undefined;
  return marking.source==='reference'&&!marking.surfaceShape&&!marking.textureId&&!marking.inference&&(marking.editMode??'projected')==='projected'&&source?.anatomy?.method==='silhouette-1'&&source.piece.color===marking.color&&reference?.illustration?.palette.includes(marking.color)?palette.get(marking.color)??marking.color:marking.color;
 };
 return {baseColor,color};
}

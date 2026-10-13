import {randomUUID} from 'node:crypto';
import type {Project,Piece} from '../../../packages/schema/index';
import {DomainError} from './repository';
export function pairedNotches(project:Project,seamId:string,count:number,depthMm:number):Piece[]{
 const seam=project.seams?.find(s=>s.id===seamId);if(!seam)throw new DomainError('ENTITY_MISSING');const pieces=new Map<string,Piece>();for(const side of [seam.a,seam.b]){const original=project.pieces.find(p=>p.id===side.pieceId),i=original?.nodes.findIndex(n=>n.id===side.nodeId)??-1;if(!original||!original.closed||i<0||original.nodes[(i+1)%original.nodes.length].id!==side.endNodeId)throw new DomainError('STALE_SEAM');const piece=pieces.get(original.id)??{...structuredClone(original),notches:original.notches?.filter(n=>n.sourceSeamId!==seamId)??[]};for(let j=1;j<=count;j++){const u=j/(count+1),position=side.reverse?side.end-u*(side.end-side.start):side.start+u*(side.end-side.start);piece.notches!.push({id:randomUUID(),sourceSeamId:seamId,nodeId:side.nodeId,position,depthMm,label:(seam.name+'/'+j).slice(0,40)});}pieces.set(piece.id,piece);}return [...pieces.values()];
}

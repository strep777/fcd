import type {Project} from '../schema/index';

/** A material-resolved panel already carries its cloth colour and its cut
 * boundary. Its source pigments are provenance, not extra lines to sew.
 * Printed/applied details and unsplit multicolour panels still retain paint. */
export function paperMarkings(project:Project,pieceId:string){
 const binding=project.bindings?.find(b=>b.pieceId===pieceId);
 // A trim mesh also exists when colour separation is disabled. An explicit
 // material contract distinguishes that case; keep legacy paint if unknown.
 const resolved=binding?.materialResolved===true&&!!binding.trim&&!!binding.colorHash;
 return (project.markings??[]).filter(m=>(!resolved||m.fabrication==='detail')&&m.paths.some(p=>p.pieceId===pieceId));
}

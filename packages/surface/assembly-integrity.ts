import type {Surface,SurfaceRun,Marking} from '../schema/index';

async function sha256(value:string){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
/** Read-only preview checks the same saved geometry fingerprints as activation.
 * In particular, matching IDs/topology alone cannot validate imported archives. */
export async function assemblyIntegrity(surface:Surface,run:SurfaceRun,markings:Marking[]=[],digest:(value:string)=>Promise<string>=sha256):Promise<boolean>{
 const surfaceHash=await digest(JSON.stringify(surface)),pieces=new Map(run.pieces.map(p=>[p.id,p]));
 if(run.sourceHash!==surfaceHash||run.bindings.some(b=>b.surfaceHash!==surfaceHash)||markings.some(m=>m.surfaceHash!==surfaceHash))return false;
 const checked=await Promise.all(run.bindings.map(async b=>{const p=pieces.get(b.pieceId);return !!p&&b.geometryHash===await digest(JSON.stringify({nodes:p.nodes,holes:p.holes??[],curves:p.curves??[]}));}));
 return checked.every(Boolean);
}

/** Shared by the renderer's in-flight registry and the backend task queue. */
export const cancellableSurfaceMethods=new Set(['surface.unwrap','library.region.edit','marking.source.edit','marking.infer','marking.surface.edit','marking.surface.brush','marking.surface','marking.texture','marking.project','marking.auto','reference.auto','reference.splitAll','reference.mask','reference.segment']);
export function isCancellableSurfaceRequest(method:string,payload:unknown){
 return cancellableSurfaceMethods.has(method)||(method==='command.apply'&&typeof payload==='object'&&payload!==null&&'type' in payload&&payload.type==='patterns.allowance');
}

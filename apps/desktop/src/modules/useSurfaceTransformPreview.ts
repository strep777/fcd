import {onBeforeUnmount,shallowRef,toRaw,watch,type Ref} from 'vue';
import type {Marking,Surface} from '../../../../packages/schema/index';
import type {Shape,World,Point} from '../../../../packages/surface/attached-edit';
import type {SurfaceOutline} from '../../../../packages/surface/marking-outline';
import type {TransformHandle} from '../../../../packages/surface/free-transform';

export type TransformPreviewRequest={id:string;shape:Shape;angleRad:number};
type Preview={key:string;fragments:Marking['fragments'];outline:SurfaceOutline[];handles:{id:TransformHandle;point:Point;world:World}[];error?:string};
export const transformPreviewKey=(request:TransformPreviewRequest)=>JSON.stringify([request.shape,request.angleRad]);
/** One worker, one in-flight projection and only the latest request per marking.
 * Pointer events never wait for clipping; stale replies cannot replace a draft. */
export function useSurfaceTransformPreview(mesh:Ref<Surface|undefined>,requests:Ref<TransformPreviewRequest[]>){
 const previews=shallowRef<Record<string,Preview>>({});
 let worker:Worker|undefined,owner:Surface|undefined,active:{id:string;key:string;token:number}|undefined,token=0,frame=0,alive=true;
 function stop(){worker?.terminate();worker=undefined;owner=undefined;active=undefined;token++;if(frame)cancelAnimationFrame(frame);frame=0;}
 function schedule(){if(!frame&&alive)frame=requestAnimationFrame(pump);}
 function pump(){
  frame=0;const surface=mesh.value;if(!surface||active||!alive)return;
  const next=requests.value.find(request=>previews.value[request.id]?.key!==transformPreviewKey(request));if(!next)return;
  const key=transformPreviewKey(next),own=++token;active={id:next.id,key,token:own};
  try{
   if(!worker){const created=new Worker(new URL('../surface-transform-worker.ts',import.meta.url),{type:'module'});worker=created;created.onmessage=({data})=>{
    if(worker!==created)return;
    const current=active;if(!current||data.token!==current.token)return;active=undefined;
    const latest=requests.value.find(request=>request.id===current.id);
    if(latest&&transformPreviewKey(latest)===current.key)previews.value={...previews.value,[current.id]:{key:current.key,fragments:data.fragments??[],outline:data.outline??[],handles:data.handles??[],error:data.error}};
    schedule();
   };created.onerror=()=>{if(worker!==created)return;const failed=active;stop();if(failed)previews.value={...previews.value,[failed.id]:{key:failed.key,fragments:[],outline:[],handles:[],error:'PREVIEW_UNAVAILABLE'}};schedule();};}
   const payload={token:own,shape:toRaw(next.shape),angleRad:next.angleRad,...(owner!==surface?{surface:toRaw(surface)}:{})};
   worker.postMessage(payload);owner=surface;
  }catch{stop();previews.value={...previews.value,[next.id]:{key,fragments:[],outline:[],handles:[],error:'PREVIEW_UNAVAILABLE'}};}
 }
 watch(mesh,()=>{stop();previews.value={};schedule();});
 watch(requests,()=>{if(!requests.value.length){stop();previews.value={};return;}schedule();},{immediate:true});
 onBeforeUnmount(()=>{alive=false;stop();});
 return previews;
}

import type {Surface} from '../schema/index';
/** Trace a connected surface seam through selected mesh vertices. */
export function surfaceCutPath(surface:Surface,start:string,end:string){
 const vertices=new Map(surface.vertices.map(v=>[v.id,v]));if(!vertices.has(start)||!vertices.has(end)||start===end)throw Error('INVALID_SELECTION');
 const neighbors=new Map<string,Set<string>>();for(const face of surface.faces)for(const id of face.vertices){const list=neighbors.get(id)??new Set<string>();for(const other of face.vertices)if(other!==id)list.add(other);neighbors.set(id,list);}
 const heap:{id:string;distance:number}[]=[],push=(entry:{id:string;distance:number})=>{heap.push(entry);let i=heap.length-1;while(i){const parent=(i-1)>>1;if(heap[parent].distance<=entry.distance)break;heap[i]=heap[parent];i=parent;}heap[i]=entry;},pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1].distance<heap[child].distance)child++;if(heap[child].distance>=last.distance)break;heap[i]=heap[child];i=child;}heap[i]=last;}return first;};
 const distance=new Map([[start,0]]),parent=new Map<string,string>();push({id:start,distance:0});
 while(heap.length){const current=pop();if(current.distance!==distance.get(current.id))continue;if(current.id===end)break;const a=vertices.get(current.id)!;for(const id of neighbors.get(current.id)??[]){const b=vertices.get(id)!,next=current.distance+Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm);if(next<(distance.get(id)??Infinity)){distance.set(id,next);parent.set(id,current.id);push({id,distance:next});}}}
 if(!parent.has(end))throw Error('CUT_PATH_DISCONNECTED');const path=[end];while(path[0]!==start)path.unshift(parent.get(path[0])!);return path.slice(1).map((id,i)=>({a:path[i],b:id,locked:true}));
}

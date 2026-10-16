import type {Surface,UnwrapOptions} from '../../../packages/schema/index';
import {DomainError} from './repository';
const key=(a:string,b:string)=>[a,b].sort().join(':');
/** Greedy normal-bounded disk growth; preserves anatomical region boundaries. */
export function automaticCutMesh(surface:Surface,options:UnwrapOptions){
 if(options.partitionStrategy==='design')return {mesh:surface,cutEdges:[] as [string,string][]};
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),edgeFaces=new Map<string,number[]>(),normals=surface.faces.map(f=>{const [a,b,c]=f.vertices.map(id=>vertices.get(id)!);const ab=[b.xMm-a.xMm,b.yMm-a.yMm,b.zMm-a.zMm],ac=[c.xMm-a.xMm,c.yMm-a.yMm,c.zMm-a.zMm],n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],l=Math.hypot(...n);return n.map(v=>v/l);});
 surface.faces.forEach((f,i)=>f.vertices.forEach((a,j)=>{const k=key(a,f.vertices[(j+1)%3]),list=edgeFaces.get(k)??[];list.push(i);edgeFaces.set(k,list);}));
 const locked=new Set((surface.cutConstraints??[]).filter(c=>c.locked).map(c=>key(c.a,c.b))),forbidden=surface.faces.map(()=>new Set<number>());for(const [edge,list] of edgeFaces)if(locked.has(edge)&&list.length===2){forbidden[list[0]].add(list[1]);forbidden[list[1]].add(list[0]);}
 const adjacency=surface.faces.map(()=>[] as number[]);for(const [edge,list] of edgeFaces)if(list.length===2&&!locked.has(edge)){const [a,b]=list;if(surface.faces[a].region===surface.faces[b].region){adjacency[a].push(b);adjacency[b].push(a);}}
 // Incremental Euler/boundary checks avoid rebuilding a whole patch for each candidate.
 const assigned=new Map<number,number>(),groups:number[][]=[],threshold=Math.cos((options.normalAngleDeg??60)*Math.PI/180),max=options.maxFacesPerPatch??400;
 const centers=surface.faces.map(f=>[0,1,2].map(axis=>f.vertices.reduce((sum,id)=>{const v=vertices.get(id)!;return sum+[v.xMm,v.yMm,v.zMm][axis];},0)/3));
 for(let seed=0;seed<surface.faces.length;seed++){
 if(assigned.has(seed))continue;
 const group:number[]=[],members=new Set<number>(),edgeCounts=new Map<string,number>(),used=new Set<string>(),degrees=new Map<string,number>();let edgeCount=0;
 const consider=(next:number,commit:boolean)=>{
 const f=surface.faces[next],changes=new Map<string,number>();let addedEdges=0,addedVertices=0;
 for(const v of f.vertices)if(!used.has(v))addedVertices++;
 for(let j=0;j<3;j++){const a=f.vertices[j],b=f.vertices[(j+1)%3],count=edgeCounts.get(key(a,b))??0;if(count>=2)return false;if(!count)addedEdges++;const delta=count===0?1:-1;changes.set(a,(changes.get(a)??0)+delta);changes.set(b,(changes.get(b)??0)+delta);}
 if(used.size+addedVertices+group.length+1!==edgeCount+addedEdges+1)return false;
 for(const [v,delta] of changes){const degree=(degrees.get(v)??0)+delta;if(degree!==0&&degree!==2)return false;}
 if(commit){f.vertices.forEach((v,j)=>{used.add(v);const k=key(v,f.vertices[(j+1)%3]);edgeCounts.set(k,(edgeCounts.get(k)??0)+1);});for(const [v,delta] of changes)degrees.set(v,(degrees.get(v)??0)+delta);edgeCount+=addedEdges;group.push(next);members.add(next);}
 return true;
 };
 // Mesh storage order has no geometric meaning. Grow nearest the seed first,
 // producing compact disks instead of strips that strand many tiny islands.
 const score=(face:number)=>centers[face].reduce((sum,v,axis)=>sum+(v-centers[seed][axis])**2,0);
 const less=(a:number,b:number)=>score(a)<score(b)||(score(a)===score(b)&&a<b);
 const pending:number[]=[],queued=new Set<number>();
 const push=(v:number)=>{if(queued.has(v)||assigned.has(v))return;queued.add(v);pending.push(v);let i=pending.length-1;while(i>0){const parent=(i-1)>>1;if(!less(pending[i],pending[parent]))break;[pending[parent],pending[i]]=[pending[i],pending[parent]];i=parent;}};
 const pop=()=>{const first=pending[0],last=pending.pop()!;if(pending.length){pending[0]=last;let i=0;for(;;){let j=i*2+1;if(j>=pending.length)break;if(j+1<pending.length&&less(pending[j+1],pending[j]))j++;if(!less(pending[j],pending[i]))break;[pending[i],pending[j]]=[pending[j],pending[i]];i=j;}}queued.delete(first);return first;};
 const id=groups.length;consider(seed,true);assigned.set(seed,id);adjacency[seed].forEach(push);
 while(pending.length&&group.length<max){const next=pop();if(assigned.has(next)||[...forbidden[next]].some(i=>members.has(i))||normals[next].reduce((s,v,j)=>s+v*normals[seed][j],0)<threshold||!consider(next,false))continue;consider(next,true);assigned.set(next,id);adjacency[next].forEach(push);}
 groups.push(group);if(groups.length>(options.maxPieces??500))throw new DomainError('PATCH_LIMIT');
 }
 const cuts:[string,string][]=[];for(const [k,list] of edgeFaces)if(list.length===2&&assigned.get(list[0])!==assigned.get(list[1]))cuts.push(k.split(':') as [string,string]);
 return {mesh:{...surface,faces:surface.faces.map((f,i)=>({...f,region:`auto-${assigned.get(i)}`}))},cutEdges:cuts};
}

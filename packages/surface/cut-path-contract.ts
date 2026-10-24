import type {Surface} from '../schema/index';
import type {FaceCut} from './refine';

type XYZ={xMm:number;yMm:number;zMm:number};
export type CutSegment={a:XYZ;b:XYZ};
const axes=['xMm','yMm','zMm'] as const;
/** One representation for drafting, validation and the saved cut comparison. */
export function cutSegmentsWorld(surface:Surface,cuts:FaceCut[]):CutSegment[]{
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),faces=new Map(surface.faces.map(f=>[f.id,f]));
 return cuts.map(c=>{const face=faces.get(c.faceId);if(!face)throw Error('INVALID_CUT');
  const at=(w:number[]):XYZ=>{const p={xMm:0,yMm:0,zMm:0};for(let i=0;i<3;i++){const v=vertices.get(face.vertices[i]);if(!v)throw Error('INVALID_CUT');for(const axis of axes)p[axis]+=w[i]*v[axis];}return p;};
  return {a:at(c.a),b:at(c.b)};
 });
}
/** Every endpoint of a user cut must have exactly two distinct neighbours.
 * Separate closed rings are allowed; dangling ends, retraces and branches are not. */
export function assertClosedCutEdges(edges:{a:string;b:string}[]){
 const neighbors=new Map<string,Set<string>>(),seen=new Set<string>();
 for(const {a,b} of edges){const key=[a,b].sort().join(':');if(a===b||seen.has(key))throw Error('CUT_NOT_CLOSED');seen.add(key);
  for(const [u,v] of [[a,b],[b,a]]){const n=neighbors.get(u)??new Set<string>();n.add(v);neighbors.set(u,n);}}
 if(edges.length<3||[...neighbors.values()].some(n=>n.size!==2))throw Error('CUT_NOT_CLOSED');
}
/** Open seams have exactly two ends and one connected chain. A closed flag
 * still promises rings; it cannot conceal gaps, branches or retraced edges. */
export function assertCutEdges(edges:{a:string;b:string}[],closed:boolean){
 if(closed){assertClosedCutEdges(edges);return;}
 const neighbors=new Map<string,Set<string>>(),seen=new Set<string>();
 for(const {a,b} of edges){const key=[a,b].sort().join(':');if(a===b||seen.has(key))throw Error('CUT_PATH_INVALID');seen.add(key);
  for(const [u,v] of [[a,b],[b,a]]){const adjacent=neighbors.get(u)??new Set<string>();adjacent.add(v);neighbors.set(u,adjacent);}}
 const ends=[...neighbors].filter(([,adjacent])=>adjacent.size===1);
 if(ends.length!==2||[...neighbors.values()].some(adjacent=>adjacent.size>2))throw Error('CUT_PATH_INVALID');
 const reached=new Set<string>(),pending=[ends[0][0]];
 while(pending.length){const id=pending.pop()!;if(reached.has(id))continue;reached.add(id);for(const next of neighbors.get(id)!)if(!reached.has(next))pending.push(next);}
 if(reached.size!==neighbors.size)throw Error('CUT_PATH_INVALID');
}
export function assertUserCutsValid(surface:Surface){
 for(const line of surface.cutLines??[])if(line.enabled&&line.kind!=='midline'){
  assertCutEdges(line.edges,line.closed);
 }
}
/** Compare complete line coverage, not just endpoints or a few probe points.
 * Refinement may subdivide a drafted segment, but must never reroute it. */
export function assertSameCutPath(draft:CutSegment[],saved:CutSegment[],tolerance=1e-5){
 if(!draft.length||!saved.length)throw Error('CUT_PATH_CHANGED');
 let work=0;
 const covers=(from:CutSegment[],to:CutSegment[])=>from.every(({a,b})=>{
  const d=axes.map(k=>b[k]-a[k]),length=Math.hypot(...d);if(length<=tolerance)return true;
  const intervals:number[][]=[];
  for(const edge of to){if(++work>20000000)throw Error('CUT_PROCESSING_LIMIT');
   if(axes.some(k=>Math.max(edge.a[k],edge.b[k])<Math.min(a[k],b[k])-tolerance||Math.min(edge.a[k],edge.b[k])>Math.max(a[k],b[k])+tolerance))continue;
   const ts=[edge.a,edge.b].map(p=>axes.reduce((s,k,i)=>s+(p[k]-a[k])*d[i],0)/(length*length));
   if([edge.a,edge.b].some((p,j)=>Math.hypot(...axes.map((k,i)=>p[k]-a[k]-ts[j]*d[i]))>tolerance))continue;
   intervals.push([Math.min(...ts),Math.max(...ts)]);
  }
  intervals.sort((x,y)=>x[0]-y[0]);let end=0;
  for(const [lo,hi] of intervals){if(lo>end+tolerance/length)return false;end=Math.max(end,hi);if(end>=1-tolerance/length)return true;}
  return false;
 });
 if(!covers(draft,saved)||!covers(saved,draft))throw Error('CUT_PATH_CHANGED');
}
/** Coverage alone cannot distinguish one traversal from an out-and-back path.
 * Both pen projectors emit one segment per traversed surface interval. */
export function assertCutTraversal(draft:CutSegment[],saved:CutSegment[],closed:boolean){
 assertSameCutPath(draft,saved);
 const length=(segments:CutSegment[])=>segments.reduce((sum,{a,b})=>sum+Math.hypot(...axes.map(axis=>b[axis]-a[axis])),0);
 const drafted=length(draft),stored=length(saved);
 if(Math.abs(drafted-stored)>Math.max(1e-5,drafted*1e-9))throw Error(closed?'CUT_NOT_CLOSED':'CUT_PATH_INVALID');
}

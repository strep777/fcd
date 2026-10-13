import type {Bary} from './refine';
/** Split a weakly simple ring at an exactly repeated station. The resulting
 * signed loops represent the same domain; negative loops remain holes. A
 * two-point retrace has zero signed area and is not a manufacturing region. */
export function materialContourLoops(rings:Bary[][]):Bary[][]{
 const result:Bary[][]=[],queue=[...rings];while(queue.length){const ring=queue.pop()!,seen=new Map<string,number>();let split=false;for(let i=0;i<ring.length;i++){const key=ring[i].join(','),previous=seen.get(key);if(previous!==undefined){const a=ring.slice(previous,i),b=[...ring.slice(i),...ring.slice(0,previous)];if(a.length>=3)queue.push(a);if(b.length>=3)queue.push(b);split=true;break;}seen.set(key,i);}if(!split&&ring.length>=3)result.push(ring);}return result;
}

export type Box=[number,number,number,number];
type Node={box:Box;items?:number[];left?:Node;right?:Node};
export const boxesOverlap=(a:Box,b:Box)=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
/** Immutable box hierarchy. Exact callers still perform their own triangle/polygon tests. */
export function boxIndex(boxes:Box[]){
 const build=(ids:number[]):Node=>{const b:Box=[Infinity,Infinity,-Infinity,-Infinity];for(const i of ids){const a=boxes[i];b[0]=Math.min(b[0],a[0]);b[1]=Math.min(b[1],a[1]);b[2]=Math.max(b[2],a[2]);b[3]=Math.max(b[3],a[3]);}if(ids.length<=12)return {box:b,items:ids};const axis=b[2]-b[0]>=b[3]-b[1]?0:1;ids.sort((a,b)=>(boxes[a][axis]+boxes[a][axis+2])-(boxes[b][axis]+boxes[b][axis+2])||a-b);const mid=ids.length>>1;return {box:b,left:build(ids.slice(0,mid)),right:build(ids.slice(mid))};};
 const root=build(boxes.map((_,i)=>i));
 return {query:(box:Box)=>{const result:number[]=[],stack=[root];while(stack.length){const n=stack.pop()!;if(!boxesOverlap(box,n.box))continue;if(n.items){for(const id of n.items)if(boxesOverlap(box,boxes[id]))result.push(id);}else stack.push(n.left!,n.right!);}return result.sort((a,b)=>a-b);}};
}

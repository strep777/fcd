import type {Reference} from '../../../../packages/schema/index';
export function referenceScene(references:Reference[]){
 const candidate=references.find(r=>r.sheet?.png)?.sheet;
 const sheet=candidate&&references.every(r=>r.sheet?.id===candidate.id)?candidate:undefined;
 let x=0;
 const frames=references.map(reference=>{const offset=sheet&&reference.sheet?.id===sheet.id?{x:reference.sheet.x,y:reference.sheet.y}:{x,y:0};x+=reference.width+24;return {reference,...offset};});
 return {width:sheet?.width??Math.max(1,...frames.map(f=>f.x+f.reference.width)),height:sheet?.height??Math.max(1,...references.map(r=>r.height)),png:sheet?.png,frames};
}
export type ReferenceScene=ReturnType<typeof referenceScene>;

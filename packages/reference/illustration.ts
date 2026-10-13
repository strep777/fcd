import {bodyParts,type BodyPart,type BodySide} from './body-parts';
import {rasterComponents} from './raster';
import {borderBackground} from './background';
import {pigmentInstances} from './region-instances';
import {recoverYellowShadows,suppressUnsupportedWarmShadows} from './pigment-shadows';
import {structureInstances} from './structure-separation';
import {armFrameSupport} from './arm-frame-support';
import {standingLimbSupport} from './standing-limb-support';
import {recoverBluePigments} from './blue-pigments';
import {terminalPawSupport} from './terminal-paw-support';
import {refineImageEdgeOwnership} from './image-edge-evidence';
import {refineWarmMaterialLabels} from './image-warm-materials';
export type PixelBox={minX:number;minY:number;maxX:number;maxY:number};
export type IllustrationContext={part:BodyPart;side:BodySide;confidence:number};
export type IllustrationRegion={part:BodyPart;side:BodySide;color:string;indices:number[];confidence:number;contexts?:IllustrationContext[]};
const adjacent=(i:number,w:number,h:number)=>[i%w?i-1:-1,i%w<w-1?i+1:-1,i>=w?i-w:-1,i<w*(h-1)?i+w:-1].filter(v=>v>=0);
const hsv=(r:number,g:number,b:number)=>{const hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo;let hue=d?(hi===r?((g-b)/d)%6:hi===g?(b-r)/d+2:(r-g)/d+4)*60:0;if(hue<0)hue+=360;return {h:hue,s:hi?d/hi:0,v:hi/255};};
const pastelPink=(h:number,s:number)=>s>=.12&&(h<20||h>=330);
export function pigmentFamily(color:string){const f=hsv(...([1,3,5].map(i=>parseInt(color.slice(i,i+2),16)) as [number,number,number]));return f.v<.28?6:f.s<.23&&!pastelPink(f.h,f.s)?0:f.h<35||f.h>=315?1:f.h<90?2:f.h<165?3:f.h<255?4:5;}
const box=(indices:number[],w:number):PixelBox=>{let minX=w,minY=Infinity,maxX=0,maxY=0;for(const i of indices){minX=Math.min(minX,i%w);maxX=Math.max(maxX,i%w+1);minY=Math.min(minY,Math.floor(i/w));maxY=Math.max(maxY,Math.floor(i/w)+1);}return {minX,minY,maxX,maxY};};
/** Illustration colors represent pigment rather than illumination. Thin dark strokes borrow adjacent pigment. */
export function illustrationRegions(width:number,height:number,rgba:Uint8Array,excludeBackground=true,subject:'character'|'head'|'paw'|'foot'='character'){
 const size=width*height;if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||size>4096*4096||rgba.length!==size*4)throw Error('IMAGE_LIMIT');
 const foreground=new Uint8Array(size),background=excludeBackground?borderBackground(width,height,rgba):new Uint8Array(size),hue=new Float32Array(size),saturation=new Float32Array(size),value=new Float32Array(size);for(let i=0;i<size;i++){const f=hsv(rgba[i*4],rgba[i*4+1],rgba[i*4+2]);hue[i]=f.h;saturation[i]=f.s;value[i]=f.v;}
 for(let i=0;i<size;i++)foreground[i]=rgba[i*4+3]>=128?1:0;
 // Only flood near-white/transparent border background, retaining enclosed white fur.
 for(let i=0;i<size;i++)if(background[i])foreground[i]=0;
 const groups=rasterComponents(width,height,foreground),largest=Math.max(0,...groups.map(g=>g.length));for(const group of groups)if(group.length<4)for(const i of group)foreground[i]=0;
 let occupied:number[]=[];for(let i=0;i<size;i++)if(foreground[i])occupied.push(i);if(!occupied.length)throw Error('EMPTY_MASK');const bounds=box(occupied,width),span=bounds.maxY-bounds.minY;
 // Broad hue families deliberately merge highlights and shadows of the same fabric.
 const family=(i:number)=>{const f={h:hue[i],s:saturation[i],v:value[i]};if(f.v<.12||f.v<.28&&f.s<.45)return -1;if(f.s<.32&&!pastelPink(f.h,f.s))return 0;if(f.h<35||f.h>=315)return 1;if(f.h<90)return 2;if(f.h<165)return 3;if(f.h<255)return 4;return 5;};
 // A five-pixel erosion removed narrow claws and the upper taper of wider
 // nails. Three-pixel interiors still exclude thin drawn outlines, while a
 // meaningful compact core supplies independent evidence of dark material.
 const dark=(i:number)=>value[i]<.12||value[i]<.28&&saturation[i]<.45;
 const core=new Uint8Array(size);for(const i of occupied){const x=i%width,y=Math.floor(i/width);if(!dark(i)||x<1||x>=width-1||y<1||y>=height-1)continue;let deep=true;for(let dy=-1;dy<=1&&deep;dy++)for(let dx=-1;dx<=1;dx++)if(!foreground[(y+dy)*width+x+dx]||!dark((y+dy)*width+x+dx)){deep=false;break;}if(deep)core[i]=1;}const pigment=new Uint8Array(size),darkQueue:{i:number;distance:number}[]=[];for(const group of rasterComponents(width,height,core)){const b=box(group,width);if(group.length>=12&&b.maxX-b.minX>=2&&b.maxY-b.minY>=2)for(const i of group){pigment[i]=1;darkQueue.push({i,distance:0});}}for(let q=0;q<darkQueue.length;q++){const entry=darkQueue[q];if(entry.distance>=3)continue;for(const n of adjacent(entry.i,width,height))if(!pigment[n]&&foreground[n]&&dark(n)){pigment[n]=1;darkQueue.push({i:n,distance:entry.distance+1});}}
 const ink=Uint8Array.from(foreground,(v,i)=>v&&!pigment[i]&&family(i)<0?1:0);
 let labels=new Int8Array(size).fill(-1);const queue:number[]=[];
 for(const i of occupied){labels[i]=pigment[i]?6:family(i);if(labels[i]>=0)queue.push(i);}
 if(!queue.length)throw Error('EMPTY_MASK');
 // Nearest foreground fill never crosses the silhouette background.
 for(let q=0;q<queue.length;q++)for(const n of adjacent(queue[q],width,height))if(foreground[n]&&labels[n]<0){labels[n]=labels[queue[q]];queue.push(n);}
 for(const i of occupied)if(labels[i]<0)foreground[i]=0;occupied=occupied.filter(i=>foreground[i]);
 // Weak pink hue is useful beside a supported pad/inner ear, but a warm
 // cast on otherwise white fur is not independent evidence of pink fabric.
 suppressUnsupportedWarmShadows(width,height,foreground,labels,saturation,value);
 // Remove isolated JPEG pigment speckles by borrowing an adjacent surviving pigment.
 // Length is preserved: a narrow stripe is retained when its total connected area is meaningful.
 const noise=new Uint8Array(size);for(let label=0;label<7;label++){const mask=Uint8Array.from(labels,(v,i)=>foreground[i]&&v===label?1:0);for(const group of rasterComponents(width,height,mask))if(group.length<16||label!==6&&group.length<64&&group.reduce((sum,i)=>sum+saturation[i]*value[i],0)/group.length<.4)for(const i of group)noise[i]=1;}
 const cleanQueue:number[]=[];for(const i of occupied)if(!noise[i]&&adjacent(i,width,height).some(n=>noise[n]))cleanQueue.push(i);
 for(let q=0;q<cleanQueue.length;q++)for(const n of adjacent(cleanQueue[q],width,height))if(noise[n]){noise[n]=0;labels[n]=labels[cleanQueue[q]];cleanQueue.push(n);}
 // Recover enclosed glints only when their surrounding edge is a gradual
 // transition into one pigment. A sharp white painted hole stays white.
 const white=Uint8Array.from(labels,(v,i)=>foreground[i]&&v===0?1:0);
 for(const group of rasterComponents(width,height,white)){
  let edges=0,pinkEdges=0,gradual=0,exterior=false;
  for(const i of group){const x=i%width,y=Math.floor(i/width);if(!x||x===width-1||!y||y===height-1)exterior=true;for(const n of adjacent(i,width,height)){if(!foreground[n])exterior=true;if(labels[n]===0)continue;edges++;if(labels[n]===1){pinkEdges++;if(Math.hypot(rgba[i*4]-rgba[n*4],rgba[i*4+1]-rgba[n*4+1],rgba[i*4+2]-rgba[n*4+2])<45)gradual++;}}}
  if(!exterior&&edges>=4&&pinkEdges/edges>.9&&gradual/pinkEdges>.75)for(const i of group)labels[i]=1;
 }
 // Adjacent fragments separated only by a gradual threshold crossing share one pigment.
 // Require both local edge continuity and similar component chroma; a sharp painted edge stays separate.
 const regionIds=new Int32Array(size).fill(-1),colorGroups:{indices:number[];label:number;s:number;h:number}[]=[];
 for(let label=0;label<7;label++){const mask=Uint8Array.from(labels,(v,i)=>foreground[i]&&v===label?1:0);for(const indices of rasterComponents(width,height,mask)){const id=colorGroups.length;let sat=0,hx=0,hy=0;for(const i of indices){regionIds[i]=id;sat+=saturation[i];hx+=Math.cos(hue[i]*Math.PI/180);hy+=Math.sin(hue[i]*Math.PI/180);}colorGroups.push({indices,label,s:sat/indices.length,h:Math.atan2(hy,hx)*180/Math.PI});}}
 const boundaries=new Map<string,{a:number;b:number;count:number;near:number}>(),hueGap=(a:number,b:number)=>Math.abs(((a-b+540)%360)-180);
 for(const i of occupied)for(const j of [i%width+1<width?i+1:-1,i+width<size?i+width:-1]){if(j<0||regionIds[j]<0||labels[i]===labels[j])continue;const a=Math.min(regionIds[i],regionIds[j]),b=Math.max(regionIds[i],regionIds[j]),key=a+':'+b,e=boundaries.get(key)??{a,b,count:0,near:0};e.count++;if(Math.abs(value[i]-value[j])<.15&&Math.abs(saturation[i]-saturation[j])<.12&&hueGap(hue[i],hue[j])<20)e.near++;boundaries.set(key,e);}
 const parent=colorGroups.map((_,i)=>i),root=(i:number):number=>{while(parent[i]!==i)i=parent[i];return i;};
 for(const e of boundaries.values()){let a=root(e.a),b=root(e.b);if(a===b)continue;const x=colorGroups[a],y=colorGroups[b];if(x.label===6||y.label===6||e.count<3||e.near/e.count<.65||Math.abs(x.s-y.s)>.14||hueGap(x.h,y.h)>20)continue;if(x.indices.length<y.indices.length)[a,b]=[b,a];parent[b]=a;}
 for(let id=0;id<colorGroups.length;id++){const label=colorGroups[root(id)].label;for(const i of colorGroups[id].indices)labels[i]=label;}
 const recoveredShadowPixels=recoverYellowShadows(width,height,rgba,foreground,ink,labels,hue,saturation,value);
 // Yellow recovery changes component membership. Revalidate the remaining
 // warm fringes using current evidence, before palette and instance tracing.
 suppressUnsupportedWarmShadows(width,height,foreground,labels,saturation,value);
 // Correct unsupported material membership before constructing instances;
 // a later curve fit cannot repair a grey shadow assigned to a pink pad.
 labels=refineWarmMaterialLabels(width,height,rgba,foreground,labels,saturation,value).labels;
 // A thin two-sided darkness valley is an ink edge even when JPEG makes it
 // lighter than black. Restrict this softer evidence to paw/foot regions;
 // inner-ear creases and head shading do not create new fabric instances.
 const instanceInk=ink.slice(),directions=[[3,0],[3,1],[3,2],[2,3],[1,3],[0,3],[-1,3],[-2,3],[-3,2],[-3,1]];
 for(const i of occupied){if(labels[i]!==1||subject==='head'||subject==='character'&&(Math.floor(i/width)-bounds.minY)/span<.3)continue;const x=i%width,y=Math.floor(i/width);for(const [dx,dy] of directions){if(x-dx<0||x-dx>=width||x+dx<0||x+dx>=width||y-dy<0||y-dy>=height||y+dy<0||y+dy>=height)continue;const a=(y-dy)*width+x-dx,b=(y+dy)*width+x+dx;if(labels[a]===1&&labels[b]===1&&value[i]<Math.min(value[a],value[b])-.06&&saturation[i]<Math.max(saturation[a],saturation[b])+.03){instanceInk[i]=1;break;}}}
 const inkBand=instanceInk.slice();for(const i of occupied)if(instanceInk[i])for(const n of adjacent(i,width,height)){inkBand[n]=1;for(const j of adjacent(n,width,height))inkBand[j]=1;}
 const recoveredBluePixels=recoverBluePigments(width,height,foreground,labels,saturation,value);
 const palette=Array.from({length:8},(_,label)=>{const ids=occupied.filter(i=>labels[i]===label&&(label===6?value[i]<.28:family(i)===(label===7?4:label))).sort((a,b)=>value[b]-value[a]),sample=ids.slice(Math.floor(ids.length*.1),Math.max(1,Math.ceil(ids.length*.5)));const rgb=[0,1,2].map(c=>Math.round(sample.reduce((s,i)=>s+rgba[i*4+c],0)/Math.max(1,sample.length)));return '#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');});
 // A raised hand can touch this height band without connecting to the skull.
 // Its disconnected outliers must not expand the head or torso registration.
 const primaryHeadBand=(ids:number[])=>{if(!ids.length)return occupied;const mask=new Uint8Array(size);for(const i of ids)mask[i]=1;const groups=rasterComponents(width,height,mask);return groups.reduce((a,b)=>b.length>a.length?b:a,[] as number[]);};
 const headPixels=occupied.filter(i=>{const y=(Math.floor(i/width)-bounds.minY)/span;return y>.10&&y<.27;}),feetPixels=occupied.filter(i=>(Math.floor(i/width)-bounds.minY)/span>.9),headBox=box(primaryHeadBand(headPixels),width),headCenter=(headBox.minX+headBox.maxX)/2,feetCenter=feetPixels.length?feetPixels.reduce((s,i)=>s+i%width,0)/feetPixels.length:headCenter,headWidth=Math.max(span*.18,headBox.maxX-headBox.minX);
 // A tall multicolour crop alone is not a full character. Require two sizable
 // lower silhouette lobes around the head centre before applying body bands.
 const lower=Uint8Array.from(foreground,(v,i)=>v&&(Math.floor(i/width)-bounds.minY)/span>.84?1:0),feet=rasterComponents(width,height,lower).filter(g=>g.length>span*span*.002).map(g=>box(g,width)).filter(b=>b.maxY-b.minY>span*.06&&b.maxX-b.minX>span*.04),footPair=feet.some(a=>feet.some(b=>a!==b&&(a.minX+a.maxX)/2<headCenter&&(b.minX+b.maxX)/2>headCenter&&(b.minX+b.maxX-a.minX-a.maxX)/2>span*.1&&Math.abs((a.minX+a.maxX+b.minX+b.maxX)/4-headCenter)<headWidth*.5));
 // A ground shadow or enclosed white gap can connect both feet into one
 // silhouette component. Two independent, broad lower pigment supports are
 // additional evidence of paired feet; they do not alter the source mask.
 // Require equal-height supports near the head axis, so a low lateral tail or
 // one coloured extremity cannot enable whole-body classification.
 const lowerPigment=Uint8Array.from(lower,(v,i)=>v&&labels[i]>0?1:0),pigmentFeet=rasterComponents(width,height,lowerPigment)
  .filter(g=>g.length>span*span*.002).map(g=>box(g,width))
  .filter(b=>b.maxY-b.minY>span*.06&&b.maxX-b.minX>span*.04);
 const supportedFootPair=pigmentFeet.flatMap(a=>pigmentFeet.filter(b=>{
  const ax=(a.minX+a.maxX)/2,bx=(b.minX+b.maxX)/2;
  return ax<headCenter-span*.04&&bx>headCenter+span*.04&&a.maxX<b.minX
   &&Math.abs(ax-headCenter)<headWidth*.65&&Math.abs(bx-headCenter)<headWidth*.65
   &&bx-ax>span*.1&&Math.abs((ax+bx)/2-headCenter)<headWidth*.25
   &&Math.abs((a.minY+a.maxY-b.minY-b.maxY)/2)<span*.05;
 }).map(b=>[a,b] as const))[0];
 const meaningfulColors=new Set(occupied.map(i=>labels[i])).size,anatomical=meaningfulColors>=3&&span>=width*.45&&(footPair||!!supportedFootPair);
 const supportedFoot=(x:number,y:number)=>!supportedFootPair||footPair||supportedFootPair.some(b=>x>=b.minX-span*.06&&x<=b.maxX+span*.06&&y>=b.minY-span*.015);

 const pink=Uint8Array.from(labels,(v,i)=>foreground[i]&&v===1?1:0),paws=rasterComponents(width,height,pink).filter(g=>g.length>=Math.max(12,span*span*.0003)&&g.reduce((s,i)=>s+saturation[i]*value[i],0)/g.length>.15).map(g=>box(g,width)).filter(b=>{const y=((b.minY+b.maxY)/2-bounds.minY)/span;return y>.3&&y<.80&&b.maxX-b.minX<span*.23&&b.maxY-b.minY<span*.23&&Math.abs((b.minX+b.maxX)/2-headCenter)>headWidth*.25;});
 // In a back view pads may have no pink material. Only the independently
 // supported connected-feet fallback may supply compact bilateral dark hand
 // evidence. One lateral tail, or a long dark flank, cannot create this pair.
 if(supportedFootPair&&!footPair&&paws.length<2){
  const darkHands=rasterComponents(width,height,Uint8Array.from(labels,(v,i)=>foreground[i]&&v===6?1:0))
   .filter(g=>g.length>span*span*.0008).map(g=>box(g,width)).filter(b=>{
    const t=((b.minY+b.maxY)/2-bounds.minY)/span,cx=(b.minX+b.maxX)/2;
    return t>.42&&t<.67&&b.maxX-b.minX>span*.03&&b.maxY-b.minY>span*.03
     &&b.maxX-b.minX<span*.18&&b.maxY-b.minY<span*.18
     &&Math.abs(cx-headCenter)>headWidth*.5&&Math.abs(cx-headCenter)<span*.32;
   });
  const pair=darkHands.flatMap(a=>darkHands.filter(b=>{
   const ax=(a.minX+a.maxX)/2,bx=(b.minX+b.maxX)/2;
   return ax<headCenter&&bx>headCenter&&Math.abs((ax+bx)/2-headCenter)<headWidth*.2
    &&Math.abs((a.minY+a.maxY-b.minY-b.maxY)/2)<span*.07;
  }).map(b=>[a,b] as const))[0];
  if(pair)paws.push(...pair);
 }
 const standing=anatomical?standingLimbSupport(width,height,foreground,saturation,value,bounds.minY,span,headBox,paws):undefined;
 const supportedFeetCenter=supportedFootPair&&!footPair?supportedFootPair.reduce((sum,b)=>sum+(b.minX+b.maxX)/2,0)/2:feetCenter;
 const inferredPawPixels=new Map<number,'left'|'right'>();
 const classify=(i:number):{part:BodyPart;side:BodySide;confidence:number}=>{if(subject!=='character')return {part:subject,side:subject==='head'?'center':'unknown',confidence:1};if(!anatomical)return {part:'unknown',side:'unknown',confidence:0};const inferred=inferredPawPixels.get(i);if(inferred)return {part:'paw',side:inferred,confidence:.78};const x=i%width,y=Math.floor(i/width),t=(y-bounds.minY)/span,center=headCenter+(supportedFeetCenter-headCenter)*Math.max(0,Math.min(1,(t-.2)/.7)),delta=x-center,side:BodySide=Math.abs(delta)<headWidth*.12?'center':delta<0?'left':'right';if(t<.16&&Math.abs(delta)>headWidth*.22)return {part:'ear',side,confidence:.7};if(t<.3)return x<headBox.minX||x>=headBox.maxX?{part:'unknown',side:'unknown',confidence:0}:{part:'head',side:'center',confidence:.85};if(t>.85&&Math.abs(delta)<headWidth*1.1&&supportedFoot(x,y))return {part:'foot',side,confidence:.8};if(paws.some(b=>x>=b.minX-span*.025&&x<=b.maxX+span*.025&&y>=b.minY-span*.03&&y<=b.maxY+span*.035))return {part:'paw',side,confidence:.78};if(standing&&y>=standing.hipY&&Math.abs(delta)<=standing.legHalfWidth)return {part:'leg',side,confidence:.7};if(standing&&y>=standing.hipY&&Math.abs(delta)>standing.legHalfWidth)return {part:'tail',side:'center',confidence:.6};if(standing&&y>=standing.shoulderTop&&y<=standing.shoulderBottom){const seam=standing.shoulderAt(y);if(x<seam.left||x>seam.right)return {part:'arm',side,confidence:.6};}if(t>.53&&Math.abs(delta)>headWidth*.70)return {part:'tail',side:'center',confidence:.6};if(Math.abs(delta)>headWidth*.43&&t<=.70)return {part:'arm',side,confidence:.6};if(t>.70)return {part:'leg',side,confidence:.7};return {part:'body',side:'center',confidence:.82};};
 // Candidate support is measured against its anatomical context as well as
 // the whole connected pigment. A white torso can contain most of an arm
 // while that arm is only a few percent of the continuous white source.
 const contextPixels=new Map<string,number>();for(const i of occupied){const c=classify(i),key=c.part+':'+c.side;contextPixels.set(key,(contextPixels.get(key)??0)+1);}
 // Broad paired dark outer-ear lobes are distinct evidence from a positional
 // majority. A lone dark protrusion, thin ink stroke, or narrow horn cannot
 // satisfy this bilateral shape support.
 const upperDark=rasterComponents(width,height,Uint8Array.from(labels,(v,i)=>anatomical&&foreground[i]&&v===6&&(Math.floor(i/width)-bounds.minY)/span<.2?1:0))
  .map(ids=>({ids,b:box(ids,width)})).filter(({b})=>b.minY<bounds.minY+span*.06&&b.maxY-b.minY>span*.12&&b.maxX-b.minX>span*.06&&(b.maxX-b.minX)/(b.maxY-b.minY)>.35);
 const darkEarPair=upperDark.flatMap(a=>upperDark.filter(b=>{const ax=(a.b.minX+a.b.maxX)/2,bx=(b.b.minX+b.b.maxX)/2;return ax<headCenter-headWidth*.2&&bx>headCenter+headWidth*.2&&Math.abs((ax+bx)/2-headCenter)<headWidth*.15&&Math.abs((a.b.minY+a.b.maxY-b.b.minY-b.b.maxY)/2)<span*.05;}).map(b=>[a,b] as const))[0];
 const darkEarSupport=new Set(darkEarPair?.flatMap(v=>v.ids)??[]);
 const regions:IllustrationRegion[]=[],minimum=4;let discardedPixels=0;
 for(let label=0;label<8;label++){
  const mask=new Uint8Array(size);for(const i of occupied)if(labels[i]===label)mask[i]=1;
  // Warm light pigments often have brown drawn separators rather than black
  // ink. Preserve independent interiors across those strokes, after removing
  // illumination changes; pink pads retain their own validated soft-ink path.
  const instances=label===2?structureInstances(width,height,mask,ink,rgba,value):pigmentInstances(width,height,mask,ink,label===1?inkBand:undefined,value);
  for(const group of instances){
   if(group.length<minimum){discardedPixels+=group.length;continue;}
   const votes=new Map<string,{part:BodyPart;side:BodySide;confidence:number;count:number}>();
   for(const i of group){const c=classify(i),key=c.part+':'+c.side,v=votes.get(key)??{...c,count:0};v.count++;votes.set(key,v);}
   const winner=[...votes.values()].sort((a,b)=>b.count-a.count)[0];
   // Anatomical transitions are placement candidates, never fabric boundaries.
   // Keep the connected pigment intact; projecting it onto several target
   // parts must not manufacture straight cuts in the source color outline.
   const bodyVotes=votes.get('body:center')?.count??0,headPartVotes=[...votes.values()].filter(v=>v.part==='head'||v.part==='ear'||v.part==='unknown').reduce((n,v)=>n+v.count,0);
   const bilateralLimbSupport=['left','right'].every(side=>[...votes.values()].some(v=>['arm','leg'].includes(v.part)&&v.side===side&&v.count>=Math.max(64,(contextPixels.get(v.part+':'+side)??Infinity)*.2)));
   const supportedTrunk=bodyVotes>=span*span*.02&&bodyVotes/group.length>.15
    ||!!standing&&bilateralLimbSupport&&bodyVotes>=span*span*.008&&bodyVotes/group.length>.05;
   const contextualTrunk=subject==='character'&&anatomical&&supportedTrunk&&bodyVotes/group.length<.95&&headPartVotes/group.length<.01;
   const groupBox=box(group,width),headCount=votes.get('head:center')?.count??0;
   // A central collar crossing the skull/trunk transition has independent
   // support on both sides of that transition. Retain both placement contexts
   // without cutting the V-shaped material or relabeling arbitrary dark ink.
   const collar=label===6&&anatomical&&headCount/group.length>.2&&bodyVotes/group.length>.2
    &&(headCount+bodyVotes)/group.length>.9&&group.length>span*span*.002
    &&groupBox.minY>bounds.minY+span*.2&&groupBox.maxY<bounds.minY+span*.44
    &&groupBox.minX>headCenter-headWidth*.4&&groupBox.maxX<headCenter+headWidth*.4;
   // A narrow continuous flank can cross a supported hip seam without
   // containing both limbs or enough pigment to count as the full trunk.
   // Either the torso or leg may contain most pixels; retain both candidates.
   const hipLeg=[...votes.values()].filter(v=>v.part==='leg'&&(v.side==='left'||v.side==='right')).sort((a,b)=>b.count-a.count)[0];
   const contextualHip=subject==='character'&&anatomical&&!!standing&&hipLeg&&(winner.part==='leg'||winner.part==='body')
    &&hipLeg.count/group.length>.1&&bodyVotes/group.length>.1&&(hipLeg.count+bodyVotes)/group.length>.9&&bodyVotes>=span*span*.0006&&headPartVotes===0
    &&groupBox.minY<standing.hipY&&groupBox.maxY>standing.hipY+span*.1&&groupBox.maxX-groupBox.minX<headWidth*.5;
   const contextualChest=subject==='character'&&!!standing&&label===0&&headCount/group.length>.5&&bodyVotes/group.length>.08
    &&(headCount+bodyVotes)/group.length>.98&&bodyVotes>=64&&groupBox.minY>bounds.minY+span*.16&&groupBox.maxY<bounds.minY+span*.44
    &&groupBox.minX>headCenter-headWidth*.4&&groupBox.maxX<headCenter+headWidth*.4;
   // A compact cap crossing a measured shoulder joint supports both target
   // surfaces. A forearm patch below the joint cannot gain a torso candidate.
   const contextualShoulder=subject==='character'&&!!standing&&winner.part==='arm'&&(winner.side==='left'||winner.side==='right')
    &&winner.count/group.length>.65&&group.length>=span*span*.0006&&headPartVotes/group.length<.35
    &&groupBox.minY>=standing.shoulderTop-span*.035&&groupBox.minY<=standing.shoulderTop+span*.035
    &&groupBox.maxY>standing.shoulderTop+span*.025&&groupBox.maxY<=standing.shoulderBottom&&groupBox.maxX-groupBox.minX<headWidth*.3;
   let contexts=contextualTrunk||collar||contextualHip||contextualChest?[...votes.values()].filter(v=>v.part!=='unknown'&&(!(collar||contextualChest)||v.part==='head'||v.part==='body')
    &&!( ['arm','leg','paw','foot'].includes(v.part)&&v.side==='center')
    &&v.count>=64&&(v.count>=group.length*.08
     ||contextualTrunk&&['arm','leg','paw','foot'].includes(v.part)&&v.count>=(contextPixels.get(v.part+':'+v.side)??Infinity)*.2))
    .map(v=>({part:v.part,side:v.side,confidence:v.confidence*v.count/group.length})):undefined;
   if(contextualShoulder)contexts=[{part:'arm',side:winner.side,confidence:winner.confidence*winner.count/group.length},{part:'body',side:'center',confidence:.55}];

   // A positional majority is not evidence that a connected protrusion is an
   // ear. In particular, colored horns next to ears must not auto-place there.
   const earVotes=[...votes.values()].filter(v=>v.part==='ear').reduce((n,v)=>n+v.count,0),headVotes=[...votes.values()].filter(v=>v.part==='head').reduce((n,v)=>n+v.count,0);
   // Blue head fur may continue into the outer ear. Allow this only when the
   // head dominates and central lower-face pixels support it; isolated colored
   // protrusions and cross-body components retain their conservative ambiguity.
   const faceSupport=label===4&&winner.part==='head'&&headVotes/group.length>=.65?group.reduce((n,i)=>{const t=(Math.floor(i/width)-bounds.minY)/span;return n+(t>.20&&t<.30&&Math.abs(i%width-headCenter)<headWidth*.25?1:0);},0):0;
   const supportedHead=faceSupport>=Math.max(16,group.length*.03);
   const supportedDarkEar=label===6&&winner.part==='ear'&&earVotes/group.length>.75&&group.reduce((n,i)=>n+(darkEarSupport.has(i)?1:0),0)/group.length>.8;
   const ambiguous=subject==='character'&&(earVotes/group.length>.15&&headVotes/group.length>.15&&!supportedHead&&!supportedDarkEar||winner.part==='ear'&&label!==0&&label!==1&&!supportedDarkEar||winner.count/group.length<.65);
   regions.push({part:ambiguous?'unknown':winner.part,side:ambiguous?'unknown':winner.side,confidence:ambiguous?0:winner.confidence*winner.count/group.length,color:palette[label],indices:group,...(contexts?.length?{contexts}:{})});
  }
 }
 if(!regions.length)throw Error('EMPTY_MASK');if(regions.length>500)throw Error('REGION_COMPLEXITY');
 // A neutral hand can have claws but no visible pink pads. Only a missing
 // paw side with an independently supported distal neutral+multiple-tip
 // instance gains metadata; sources, palette and exact pixel ownership stay
 // unchanged. Do not add an expanded box to positional classification: that
 // would relabel the neighbouring cuff as palm.
 if(subject==='character'&&anatomical){
  const existing=new Set<'left'|'right'>();for(const i of occupied){const c=classify(i);if(c.part==='paw'&&(c.side==='left'||c.side==='right'))existing.add(c.side);}
  if(existing.size<2){
   const arms=new Map<'left'|'right',number[]>();for(const i of occupied){const c=classify(i);if(c.part==='arm'&&(c.side==='left'||c.side==='right')){const ids=arms.get(c.side)??[];ids.push(i);arms.set(c.side,ids);}}
   for(const [side,ids]of arms)arms.set(side,armFrameSupport(width,height,ids,bounds.minY,span,paws));
   for(const hand of terminalPawSupport({width,span,top:bounds.minY,head:headBox,regions,saturation,value,arms,existing}))for(const index of hand.regionIndices){const r=regions[index];r.part='paw';r.side=hand.side;r.confidence=.78;delete r.contexts;for(const i of r.indices)inferredPawPixels.set(i,hand.side);}
  }
 }
 // Registration frames describe the full anatomical foreground context,
 // independently of whether a particular pigment component gets a safe label.
 // Raised paws do not expand the head frame; ears/horns do not set skull height.
 const contextual=new Map<BodyPart,number[]>(),sided=new Map<string,number[]>();for(const i of occupied){const {part,side}=classify(i);if(part==='head'&&subject==='character'&&(Math.floor(i/width)-bounds.minY)/span<.08)continue;const list=contextual.get(part)??[];list.push(i);contextual.set(part,list);if((side==='left'||side==='right')&&['arm','leg','paw','foot','ear','horn'].includes(part)){const key=part+':'+side,ids=sided.get(key)??[];ids.push(i);sided.set(key,ids);}}
 if(subject==='character'&&anatomical){for(const side of ['left','right'] as const){const key='arm:'+side,ids=sided.get(key);if(ids)sided.set(key,armFrameSupport(width,height,ids,bounds.minY,span,paws));}contextual.set('arm',[...(sided.get('arm:left')??[]),...(sided.get('arm:right')??[])]);}
 const partBounds:{part:BodyPart;side?:BodySide;orientationRad?:number;frameCorners?:{x:number;y:number}[];minX:number;minY:number;maxX:number;maxY:number}[]=bodyParts.flatMap(part=>{const ids=contextual.get(part);return ids?.length?[{part,...box(ids,width)}]:[];});
 for(const part of bodyParts)for(const side of ['left','right'] as const){const ids=sided.get(part+':'+side);if(!ids?.length)continue;const mx=ids.reduce((s,i)=>s+i%width,0)/ids.length,my=ids.reduce((s,i)=>s+Math.floor(i/width),0)/ids.length;let xx=0,xy=0,yy=0;for(const i of ids){const x=i%width-mx,y=Math.floor(i/width)-my;xx+=x*x;xy+=x*y;yy+=y*y;}const spread=Math.hypot(xx-yy,2*xy)/(xx+yy||1),orientationRad=.5*Math.atan2(2*xy,xx-yy);let frameCorners:{x:number;y:number}[]|undefined;
  if(spread>.2&&(part==='arm'||part==='leg')){const c=Math.cos(orientationRad),s=Math.sin(orientationRad),pad=.5*(Math.abs(c)+Math.abs(s));let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;for(const i of ids){const x=i%width-mx,y=Math.floor(i/width)-my,u=c*x+s*y,v=-s*x+c*y;minU=Math.min(minU,u-pad);maxU=Math.max(maxU,u+pad);minV=Math.min(minV,v-pad);maxV=Math.max(maxV,v+pad);}frameCorners=[[minU,minV],[maxU,minV],[maxU,maxV],[minU,maxV]].map(([u,v])=>({x:mx+.5+c*u-s*v,y:my+.5+s*u+c*v}));}
  partBounds.push({part,side,...(spread>.2?{orientationRad}:{}),...(frameCorners?{frameCorners}:{}),...box(ids,width)});}
 // Pigment classification identifies materials; the original RGB transition
 // locates their shared boundary. Refine that single ownership partition
 // before tracing, so both neighbours receive the same image-supported edge.
 // Anatomical registration and region topology stay fixed. Image-supported
 // silhouette corrections can remove pale background from dark antialiased tips.
 const refined=refineImageEdgeOwnership(width,height,rgba,regions);
 const foregroundPixels=occupied.length-refined.report.removedForegroundPixels;
 return {regions:refined.regions,bounds,partBounds,foregroundPixels,discardedPixels,recoveredShadowPixels,recoveredBluePixels,anatomical,palette:[...new Set(regions.map(r=>r.color))]};
}





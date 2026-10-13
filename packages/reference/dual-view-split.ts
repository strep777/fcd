import {components,encode} from './mask';
/** Use the gutter between two disjoint silhouettes, not an assumed centered drawing layout. */
export function dualViewSplit(width:number,height:number,rgba:Uint8Array,sourceWidth:number){
 const fallback={x:Math.floor(sourceWidth/2),detected:false};
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<1||width*height>512*512||rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 const mask=new Uint8Array(width*height);for(let i=0;i<mask.length;i++)mask[i]=rgba[i*4+3]>=128&&Math.min(rgba[i*4],rgba[i*4+1],rgba[i*4+2])<238?1:0;
 const groups=components(encode(width,height,mask)).sort((a,b)=>b.length-a.length).slice(0,2);
 if(groups.length!==2||groups[1].length<groups[0].length*.35)return fallback;
 const boxes=groups.map(ids=>{let minX=width,maxX=0;for(const i of ids){minX=Math.min(minX,i%width);maxX=Math.max(maxX,i%width+1);}return {minX,maxX};}).sort((a,b)=>a.minX-b.minX),[left,right]=boxes;
 if(left.maxX>=right.minX||left.maxX-left.minX<width*.12||right.maxX-right.minX<width*.12)return fallback;
 const split=(left.maxX+right.minX)/2;if(split<width*.3||split>width*.7)return fallback;
 return {x:Math.round(split*sourceWidth/width),detected:true};
}

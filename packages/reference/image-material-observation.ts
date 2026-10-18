import {inferTips} from './image-line-corners';
type P={xMm:number;yMm:number};
const dot=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+v*b[i],0);
/** Observe one material's silhouette continuously across neighboring colors.
 * This is an affine measurement of the original pixels, not reclassification.
 * The transform commutes with coverage and blur. Retain its byte uncertainty
 * and alpha, and refuse ill-conditioned palettes or an oversized local crop. */
export function materialObservation(points:P[],foreground:string,backgrounds:string[],width:number,height:number,rgba:Uint8Array){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 const palette=[foreground,...backgrounds];
 if(points.length<8||points.length>512||points.some(p=>!Number.isFinite(p.xMm)||!Number.isFinite(p.yMm)||p.xMm<0||p.yMm<0||p.xMm>width||p.yMm>height)||backgrounds.length<2||backgrounds.length>3||new Set(palette).size!==palette.length||palette.some(c=>!/^#[\da-f]{6}$/i.test(c)))return;
 const colors=palette.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16))),base=colors[1],basis:number[][]=[];
 for(const color of colors.slice(2)){let vector=color.map((v,i)=>v-base[i]);for(const axis of basis){const projection=dot(vector,axis);vector=vector.map((v,i)=>v-projection*axis[i]);}const norm=Math.sqrt(dot(vector,vector));if(norm<10)return;basis.push(vector.map(v=>v/norm));}
 let direction=colors[0].map((v,i)=>v-base[i]);for(const axis of basis){const projection=dot(direction,axis);direction=direction.map((v,i)=>v-projection*axis[i]);}
 const contrast=dot(direction,direction);if(contrast<2500)return;
 const weights=direction.map(v=>128*v/contrast),quantizationError=.5+.5*weights.reduce((sum,v)=>sum+Math.abs(v),0);if(quantizationError>2)return;
 const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p.xMm)))-32),top=Math.max(0,Math.floor(Math.min(...points.map(p=>p.yMm)))-32),right=Math.min(width,Math.ceil(Math.max(...points.map(p=>p.xMm)))+32),bottom=Math.min(height,Math.ceil(Math.max(...points.map(p=>p.yMm)))+32),w=right-left,h=bottom-top;
 if(w*h>65536)return;
 const image=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=4*((y+top)*width+x+left),j=4*(y*w+x),value=64+dot(weights,[0,1,2].map(k=>rgba[i+k]-base[k]));image[j]=image[j+1]=image[j+2]=Math.max(0,Math.min(255,Math.round(value)));image[j+3]=value>=0&&value<=255?rgba[i+3]:0;}
 return{left,top,width:w,height:h,image,quantizationError,weights};
}
export function materialTips(points:P[],closed:boolean,foreground:string,backgrounds:string[],width:number,height:number,rgba:Uint8Array,extended=false){
 const observed=materialObservation(points,foreground,backgrounds,width,height,rgba);if(!observed)return;
 const {left,top}=observed,local=(p:P)=>({xMm:p.xMm-left,yMm:p.yMm-top}),world=(p:P)=>({...p,xMm:p.xMm+left,yMm:p.yMm+top});
 const model=inferTips(points.map(local),closed,observed.width,observed.height,observed.image,{proposalRange:extended?4:1.5,quantizationError:observed.quantizationError});
 return{...model,source:model.source.map(world),candidates:model.candidates.map(c=>({...c,point:world(c.point),tip:world(c.tip),left:{...c.left,c:world(c.left.c),points:c.left.points.map(world)},right:{...c.right,c:world(c.right.c),points:c.right.points.map(world)}}))};
}

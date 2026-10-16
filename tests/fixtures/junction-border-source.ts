import type{Point}from'../../packages/schema/index';
const width=64,height=64,palette=[[230,50,70],[40,90,230],[40,210,90]],hex=['#e63246','#285ae6','#28d25a'],p=(xMm:number,yMm:number,id=''):Point=>({xMm,yMm,id});
function pixels(){const rgba=new Uint8Array(width*height*4),aa=8;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sum=[0,0,0];for(let sy=0;sy<aa;sy++)for(let sx=0;sx<aa;sx++){const yy=y+(sy+.5)/aa,color=palette[yy<24.25?0:yy<36.25?1:2];for(let k=0;k<3;k++)sum[k]+=color[k];}rgba.set([...sum.map(v=>Math.round(v/(aa*aa))),255],4*(y*width+x));}return rgba;}
function inside(q:{xMm:number;yMm:number},ring:Point[]){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.yMm>q.yMm)!==(b.yMm>q.yMm)&&q.xMm<(b.xMm-a.xMm)*(q.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)hit=!hit;}return hit;}

export{width,height,palette,hex,p,pixels,inside};

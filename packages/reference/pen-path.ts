export type PenPoint={x:number;y:number};
export type PenNode=PenPoint&{in?:PenPoint;out?:PenPoint};
export type PenPath={nodes:PenNode[];closed:boolean;subtract:boolean};
const mix=(a:PenPoint,b:PenPoint,t:number):PenPoint=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
export function penSvg(p:PenPath){if(!p.nodes.length)return '';let d=`M${p.nodes[0].x} ${p.nodes[0].y}`;for(let i=1;i<p.nodes.length+(p.closed?1:0);i++){const a=p.nodes[i-1],b=p.nodes[i%p.nodes.length];d+=a.out||b.in?` C${(a.out??a).x} ${(a.out??a).y} ${(b.in??b).x} ${(b.in??b).y} ${b.x} ${b.y}`:` L${b.x} ${b.y}`;}return d+(p.closed?' Z':'');}
export function flattenPen(p:PenPath,tolerance=.25):PenPoint[]{
 const output:PenPoint[]=[];if(!p.closed||p.nodes.length<3)throw Error('OPEN_PATH');
 const distance=(p:PenPoint,a:PenPoint,b:PenPoint)=>{const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);};
 function curve(a:PenPoint,b:PenPoint,c:PenPoint,d:PenPoint,depth=0){if(output.length>20000||depth>20)throw Error('RESOURCE_LIMIT');if(Math.max(distance(b,a,d),distance(c,a,d))<=tolerance){output.push(a);return;}const ab=mix(a,b,.5),bc=mix(b,c,.5),cd=mix(c,d,.5),abc=mix(ab,bc,.5),bcd=mix(bc,cd,.5),mid=mix(abc,bcd,.5);curve(a,ab,abc,mid,depth+1);curve(mid,bcd,cd,d,depth+1);}
 for(let i=0;i<p.nodes.length;i++){const a=p.nodes[i],b=p.nodes[(i+1)%p.nodes.length];curve(a,a.out??a,b.in??b,b);}
 return output;
}
/** Rasterization only runs after confirmation, in a worker. Scanlines avoid O(pixels × nodes). */
export function rasterizePen(width:number,height:number,paths:PenPath[]){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||paths.length>100||paths.reduce((n,p)=>n+p.nodes.length,0)>10000)throw Error('RESOURCE_LIMIT');
 const data=new Uint8Array(width*height);let flattened=0;
 for(const path of paths){for(const node of path.nodes)for(const point of [node,node.in,node.out].filter(Boolean) as PenPoint[])if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x< -width||point.x>width*2||point.y< -height||point.y>height*2)throw Error('INVALID_MASK');
  const ring=flattenPen(path);flattened+=ring.length;if(flattened>100000)throw Error('RESOURCE_LIMIT');const minY=Math.max(0,Math.floor(Math.min(...ring.map(p=>p.y)))),maxY=Math.min(height,Math.ceil(Math.max(...ring.map(p=>p.y))));
  for(let y=minY;y<maxY;y++){const crossings:number[]=[];for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>y+.5)!==(b.y>y+.5))crossings.push(a.x+(y+.5-a.y)*(b.x-a.x)/(b.y-a.y));}crossings.sort((a,b)=>a-b);for(let i=0;i+1<crossings.length;i+=2){const start=Math.max(0,Math.min(width,Math.ceil(crossings[i]-.5))),end=Math.max(0,Math.min(width,Math.ceil(crossings[i+1]-.5)));if(end>start)data.fill(path.subtract?0:1,y*width+start,y*width+end);}}
 }
 let count=0;for(const v of data)count+=v;return {mask:{width,height,pixels:Array.from(data,v=>v?'1':'0').join('')},count};
}
/** Keep a light editable path after freehand capture, not thousands of pointer samples. */
export function simplifyPen(points:PenPoint[],tolerance=1):PenPoint[]{
 if(points.length<3)return points;const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
 while(stack.length){const [a,b]=stack.pop()!,u=points[a],v=points[b],dx=v.x-u.x,dy=v.y-u.y,den=dx*dx+dy*dy;let best=tolerance,index=-1;for(let i=a+1;i<b;i++){const p=points[i],t=den?Math.max(0,Math.min(1,((p.x-u.x)*dx+(p.y-u.y)*dy)/den)):0,d=Math.hypot(p.x-u.x-dx*t,p.y-u.y-dy*t);if(d>best){best=d;index=i;}}if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}}
 return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}

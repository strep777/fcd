import type {Point,Piece} from '../../packages/schema/index';
import type {inferTips} from '../../packages/reference/image-line-corners';

export type Geometry={nodes:Point[];curves:NonNullable<Piece['curves']>};
export type Candidate=ReturnType<typeof inferTips>['candidates'][number];
export const point=(id:string,xMm:number,yMm:number):Point=>({id,xMm,yMm});
export const truth={A:point('truth-A',40,40),B:point('truth-B',60,40),C:point('truth-C',60,60)};
const mix=(a:Point,b:Point,t:number)=>point('',a.xMm+(b.xMm-a.xMm)*t,a.yMm+(b.yMm-a.yMm)*t);
export function cubic(a:Point,c1:Point,c2:Point,b:Point,t:number):Point{
 const ab=mix(a,c1,t),bc=mix(c1,c2,t),cd=mix(c2,b,t);return mix(mix(ab,bc,t),mix(bc,cd,t),t);
}
export const distance=(a:Pick<Point,'xMm'|'yMm'>,b:Pick<Point,'xMm'|'yMm'>)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
export function fixture(closed=false,reverse=false,seam=false){
 // The true three corners are independent fixed intersections. The incoming
 // raster baseline misses each by a2px chamfer; retaining it cannot pass tip
 // restoration simply because a true corner already happened to be present.
 const coordinates:[string,number,number][]=[['start',40,10],['a-left',40,38],['a-right',42,40],['b-left',58,40],['b-right',60,42],['c-left',60,58],['c-right',62,60],['round-start',100,60],['round-mid',110,70],['round-end',100,80]];
 if(closed)coordinates.push(['lower-left',15,80],['upper-left',15,10]);
 let nodes=coordinates.map(([id,x,y])=>point(id,x,y));
 const k=10*.5522847498307936;
 let curves:Geometry['curves']=[{id:'round-first',startNodeId:'round-start',endNodeId:'round-mid',c1:point('arc11',100+k,60),c2:point('arc12',110,70-k)},{id:'round-second',startNodeId:'round-mid',endNodeId:'round-end',c1:point('arc21',110,70+k),c2:point('arc22',100+k,80)}];
 if(reverse){nodes=[...nodes].reverse();curves=curves.map(c=>({...c,startNodeId:c.endNodeId,endNodeId:c.startNodeId,c1:c.c2,c2:c.c1}));}
 if(seam){if(!closed)throw Error('Seam fixture requires closed path');const at=nodes.findIndex(p=>p.id==='a-right');nodes=[...nodes.slice(at),...nodes.slice(0,at)];}
 const base={nodes,curves};const source:Point[]=[];
 for(let i=0;i<nodes.length-(closed?0:1);i++){
  const a=nodes[i],b=nodes[(i+1)%nodes.length],c=curves.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id);
  const steps=c?32:Math.max(1,Math.ceil(distance(a,b)));
  for(let j=0;j<steps;j++)source.push({...c?cubic(a,c.c1,c.c2,b,j/steps):mix(a,b,j/steps),id:`source-${source.length}`});
 }
 if(!closed)source.push({...nodes.at(-1)!,id:`source-${source.length}`});
 return{base,source,closed,reverse,seam,width:128,height:128,rgba:new Uint8Array(128*128*4).fill(255)};
}
export function models(f:ReturnType<typeof fixture>,scoreOrder:('A'|'B'|'C')[],radius=14):Candidate[]{
 const centers={A:point('A-proposal',41,39),B:point('B-proposal',59,41),C:point('C-proposal',61,59)};
 const normals={A:[point('',1,0),point('',0,1)],B:[point('',0,1),point('',1,0)],C:[point('',1,0),point('',0,1)]};
 return scoreOrder.map((name,rank)=>{
  const tip=truth[name],point0=centers[name],ns=normals[name],n1=ns[f.reverse?1:0],n2=ns[f.reverse?0:1];
  let i=0;for(let j=1;j<f.source.length;j++)if(distance(f.source[j],tip)<distance(f.source[i],tip))i=j;
  const measured=(n:Point)=>({c:{xMm:tip.xMm-10*n.yMm,yMm:tip.yMm+10*n.xMm},n,error:0,max:0,points:Array.from({length:9},(_,j)=>({xMm:tip.xMm-(j+4)*n.yMm,yMm:tip.yMm+(j+4)*n.xMm})),sigma:2});
  return{i,point:point0,tip:{...tip},n1,n2,radius,sigma:2,error:.001*(rank+1),contrast:180,initialError:.001,params:[0,0,0,0,0],alternatives:[],left:measured(n1),right:measured(n2),accepted:true};
 });
}
export type Transform={angle:number;scale:number;dx:number;dy:number};
export function transform(p:Point,t:Transform){const c=Math.cos(t.angle),s=Math.sin(t.angle);return{...p,xMm:t.dx+t.scale*(p.xMm*c-p.yMm*s),yMm:t.dy+t.scale*(p.xMm*s+p.yMm*c)};}
export function mapGeometry(base:Geometry,t:Transform):Geometry{return{nodes:base.nodes.map(p=>transform(p,t)),curves:base.curves.map(c=>({...c,c1:transform(c.c1,t),c2:transform(c.c2,t)}))};}

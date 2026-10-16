import {expect,it} from 'vitest';
import {spliceSourceTips} from '../../packages/reference/image-tip-splice';
import type {Point,Piece} from '../../packages/schema/index';

type Curve=NonNullable<Piece['curves']>[number];
type Geometry={nodes:Point[];curves:Curve[]};
const p=(id:string,xMm:number,yMm:number):Point=>({id,xMm,yMm});
const mix=(a:Point,b:Point,t:number)=>p('',a.xMm+(b.xMm-a.xMm)*t,a.yMm+(b.yMm-a.yMm)*t);
// de Casteljau is an independent geometry oracle, rather than the helper's
// polynomial evaluation/derivative split. The first two source cubics have
// linear x(t), so a retained output sample locates its exact source parameter.
function at(a:Point,c1:Point,c2:Point,b:Point,t:number){const ab=mix(a,c1,t),bc=mix(c1,c2,t),cd=mix(c2,b,t);return mix(mix(ab,bc,t),mix(bc,cd,t),t);}
const gap=(a:Point,b:Point)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
function fixture():Geometry{
 const nodes=[p('A',10,20),p('B',40,30),p('C',70,20),p('D',90,20),p('E',100,30),p('F',90,40),p('G',10,40)],k=10*.5522847498307936;
 const curve=(id:string,a:string,b:string,c1:[number,number],c2:[number,number]):Curve=>({id,startNodeId:a,endNodeId:b,c1:p(id+'1',...c1),c2:p(id+'2',...c2)});
 return{nodes,curves:[curve('AB','A','B',[20,8],[30,43]),curve('BC','B','C',[50,55],[60,2]),curve('DE','D','E',[90+k,20],[100,30-k]),curve('EF','E','F',[100,30+k],[90+k,40])]};
}
function source(base:Geometry,index:number,t:number){const a=base.nodes[index],b=base.nodes[(index+1)%base.nodes.length],c=base.curves.find(c=>c.startNodeId===a.id&&c.endNodeId===b.id);return c?at(a,c.c1,c.c2,b,t):mix(a,b,t);}
function run(base:Geometry,closed:boolean,windows:Parameters<typeof spliceSourceTips>[2]){
 const before=structuredClone({base,windows});let serial=0;const result=spliceSourceTips(base,closed,windows,()=>`fresh-${++serial}`);expect({base,windows}).toEqual(before);return result;
}
function outside(base:Geometry,result:Geometry){
 let maximum=0;
 for(const c of result.curves){const a=result.nodes.find(p=>p.id===c.startNodeId)!,b=result.nodes.find(p=>p.id===c.endNodeId)!;const index=a.xMm>=10-1e-8&&b.xMm<=40+1e-8?0:a.xMm>=40-1e-8&&b.xMm<=70+1e-8?1:undefined;if(index===undefined)continue;
  for(let j=0;j<=32;j++){const q=at(a,c.c1,c.c2,b,j/32),expected=source(base,index,(q.xMm-base.nodes[index].xMm)/30);maximum=Math.max(maximum,gap(q,expected));}
 }
 expect(maximum).toBeLessThan(1e-9);
 for(const id of ['DE','EF']){
  const old=base.curves.find(c=>c.id===id)!,now=result.curves.find(c=>c.startNodeId===old.startNodeId&&c.endNodeId===old.endNodeId);expect(now).toBeDefined();expect(gap(now!.c1,old.c1)).toBeLessThan(1e-9);expect(gap(now!.c2,old.c2)).toBeLessThan(1e-9);
 }
 expect(new Set(result.nodes.map(p=>p.id)).size).toBe(result.nodes.length);
 for(const c of result.curves){const index=result.nodes.findIndex(p=>p.id===c.startNodeId);expect(result.nodes[(index+1)%result.nodes.length].id).toBe(c.endNodeId);}
}

it.each([false,true])('preserves outside cubics and an unrelated round end in closed=%s',closed=>{
 const base=fixture(),tip=p('tip',25,18),result=run(base,closed,[{from:source(base,0,.25),to:source(base,0,.75),tip}]);expect(result).toBeDefined();expect(result!.nodes.filter(p=>p.id===tip.id)).toHaveLength(1);outside(base,result!);
});

it('splices a window crossing the closed start without moving the other round end',()=>{
 const base=fixture(),tip=p('seam-tip',4,14),result=run(base,true,[{from:source(base,6,.5),to:source(base,0,.25),tip}]);expect(result).toBeDefined();outside(base,result!);expect(result!.nodes.filter(p=>p.id===tip.id)).toHaveLength(1);
});

it('keeps opposite owner traversal and reversed cubic controls on one shared geometry',()=>{
 const base=fixture(),tip=p('shared-tip',25,18),from=source(base,0,.25),to=source(base,0,.75),reversed:Geometry={nodes:[...base.nodes].reverse(),curves:base.curves.map(c=>({...c,startNodeId:c.endNodeId,endNodeId:c.startNodeId,c1:c.c2,c2:c.c1}))};
 const forward=run(base,false,[{from,to,tip}]),backward=run(reversed,false,[{from:to,to:from,tip}]);expect(forward).toBeDefined();expect(backward).toBeDefined();
 const a=forward!,b=backward!;expect(b.nodes).toHaveLength(a.nodes.length);
 for(let i=0;i<a.nodes.length;i++)expect(gap(a.nodes[i],b.nodes[b.nodes.length-1-i])).toBeLessThan(1e-4);
 for(const c of a.curves){const start=a.nodes.findIndex(p=>p.id===c.startNodeId),end=a.nodes.findIndex(p=>p.id===c.endNodeId),reverse=b.curves.find(q=>q.startNodeId===b.nodes[b.nodes.length-1-end].id&&q.endNodeId===b.nodes[b.nodes.length-1-start].id);expect(reverse).toBeDefined();expect(gap(c.c1,reverse!.c2)).toBeLessThan(1e-4);expect(gap(c.c2,reverse!.c1)).toBeLessThan(1e-4);}
});

it('rejects overlapping later and distant evidence while keeping an independent accepted tip',()=>{
 const base=fixture(),tip=p('accepted',22,18),rejected=p('overlap',30,8),result=run(base,true,[{from:p('',-40,-30),to:p('',-35,-45),tip:p('far',-45,-40)},{from:source(base,0,.2),to:source(base,0,.6),tip},{from:source(base,0,.5),to:source(base,0,.8),tip:rejected}]);
 expect(result).toBeDefined();expect(result!.nodes.some(p=>p.id==='accepted')).toBe(true);expect(result!.nodes.some(p=>p.id==='overlap'||p.id==='far')).toBe(false);outside(base,result!);
});

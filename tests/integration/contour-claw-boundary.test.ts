import {expect,it} from 'vitest';
import sharp from 'sharp';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import {pigmentFamily} from '../../packages/reference/illustration';
import {contourPolyline} from '../../packages/reference/recover-contour';
import type {Piece,Reference} from '../../packages/schema/index';

function contains(piece:Piece,x:number,y:number){
 const point={xMm:x-609+.5,yMm:750-y-.5};let inside=false;
 for(const nodes of[piece.nodes,...piece.holes??[]]){
  const ring=contourPolyline(nodes,piece.curves??[],true,.015,()=>crypto.randomUUID());
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.yMm>point.yMm)!==(b.yMm>point.yMm)&&point.xMm<(b.xMm-a.xMm)*(point.yMm-a.yMm)/(b.yMm-a.yMm)+a.xMm)inside=!inside;}
 }
 return inside;
}

it('the raised-paw claw keeps its oblique upper edge instead of restoring pixel stairs',async()=>{
 const png=await sharp('tests/fixtures/character-front-back.jpg').extract({left:609,top:0,width:666,height:750}).png().toBuffer();
 // Fixed original-JPEG black cores identify this claw independently of the
 // palette representative, which may change when antialiased pixels move.
 const rgba=await sharp(png).ensureAlpha().raw().toBuffer(),core=[[663,229],[666,230],[670,232]];
 for(const[x,y]of core){const i=(y*666+x-609)*4;expect(rgba[i+3]).toBe(255);expect(Math.max(...rgba.subarray(i,i+3))).toBeLessThan(30);}
 const reference:Reference={id:'claw-front',name:'front',view:'front',width:666,height:750,png:'data:image/png;base64,'+png.toString('base64'),resources:{} as Reference['resources'],calibration:{a:{x:0,y:750},b:{x:0,y:0},distanceMm:750},calibrationMode:'manual'};
 const back=await sharp('tests/fixtures/character-front-back.jpg').extract({left:0,top:0,width:609,height:750}).png().toBuffer();
 const pieces=splitReferences([reference,{...reference,id:'claw-back',view:'back',width:609,png:'data:image/png;base64,'+back.toString('base64')}],750,6,true).regions.filter(r=>r.view==='front').map(r=>r.piece);
 const candidates=pieces.filter(p=>pigmentFamily(p.color!)===6&&core.every(([x,y])=>contains(p,x,y)));
 expect(candidates).toHaveLength(1);
 const claw=candidates[0];
 expect(claw).toBeDefined();
 expect(Math.min(...claw.nodes.map(n=>n.xMm))+609).toBeGreaterThan(654);expect(Math.max(...claw.nodes.map(n=>n.xMm))+609).toBeLessThan(678);
 expect(Math.min(...claw.nodes.map(n=>750-n.yMm))).toBeGreaterThan(222);expect(Math.max(...claw.nodes.map(n=>750-n.yMm))).toBeLessThan(239);
 // Original-image window follows the sloping top of the small right claw;
 // the sharp terminal tip and its two material junctions lie outside it.
 const turns=claw.nodes.flatMap((n,i)=>{
  const x=n.xMm+609,y=750-n.yMm;if(x<662||x>670||y<225||y>230)return [];
  const incoming=claw.curves?.find(c=>c.endNodeId===n.id),outgoing=claw.curves?.find(c=>c.startNodeId===n.id),a=incoming?.c2??claw.nodes[(i+claw.nodes.length-1)%claw.nodes.length],b=outgoing?.c1??claw.nodes[(i+1)%claw.nodes.length];
  const u={x:n.xMm-a.xMm,y:n.yMm-a.yMm},v={x:b.xMm-n.xMm,y:b.yMm-n.yMm};
  return [{x,y,turn:Math.abs(Math.atan2(u.x*v.y-u.y*v.x,u.x*v.x+u.y*v.y))}];
 });
 expect(Math.max(0,...turns.map(v=>v.turn)),JSON.stringify(turns)).toBeLessThanOrEqual(Math.PI/6);
},120000);

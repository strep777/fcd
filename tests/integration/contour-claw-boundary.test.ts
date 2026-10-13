import {expect,it} from 'vitest';
import sharp from 'sharp';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import type {Reference} from '../../packages/schema/index';

it('the raised-paw claw keeps its oblique upper edge instead of restoring pixel stairs',async()=>{
 const png=await sharp('tests/fixtures/character-front-back.jpg').extract({left:609,top:0,width:666,height:750}).png().toBuffer();
 const reference:Reference={id:'claw-front',name:'front',view:'front',width:666,height:750,png:'data:image/png;base64,'+png.toString('base64'),resources:{} as Reference['resources'],calibration:{a:{x:0,y:750},b:{x:0,y:0},distanceMm:750},calibrationMode:'manual'};
 const back=await sharp('tests/fixtures/character-front-back.jpg').extract({left:0,top:0,width:609,height:750}).png().toBuffer();
 const pieces=splitReferences([reference,{...reference,id:'claw-back',view:'back',width:609,png:'data:image/png;base64,'+back.toString('base64')}],750,6,true).regions.filter(r=>r.view==='front').map(r=>r.piece);
 const claw=pieces.find(p=>p.color==='#08060a'&&Math.min(...p.nodes.map(n=>n.xMm))+609>654&&Math.max(...p.nodes.map(n=>n.xMm))+609<678&&Math.min(...p.nodes.map(n=>750-n.yMm))>222&&Math.max(...p.nodes.map(n=>750-n.yMm))<239)!;
 expect(claw).toBeDefined();
 // Original-image window follows the sloping top of the small right claw;
 // the sharp terminal tip and its two material junctions lie outside it.
 const turns=claw.nodes.flatMap((n,i)=>{
  const x=n.xMm+609,y=750-n.yMm;if(x<662||x>670||y<225||y>230)return [];
  const incoming=claw.curves?.find(c=>c.endNodeId===n.id),outgoing=claw.curves?.find(c=>c.startNodeId===n.id),a=incoming?.c2??claw.nodes[(i+claw.nodes.length-1)%claw.nodes.length],b=outgoing?.c1??claw.nodes[(i+1)%claw.nodes.length];
  const u={x:n.xMm-a.xMm,y:n.yMm-a.yMm},v={x:b.xMm-n.xMm,y:b.yMm-n.yMm};
  return [{x,y,turn:Math.abs(Math.atan2(u.x*v.y-u.y*v.x,u.x*v.x+u.y*v.y))}];
 });
 expect(Math.max(0,...turns.map(v=>v.turn)),JSON.stringify(turns)).toBeLessThanOrEqual(Math.PI/6);
},30000);

import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {project,rectangle} from '../fixtures';
import {anatomicalPlacement} from '../../apps/desktop/main/anatomical-placement';
import {placedPoint} from '../../packages/reference/placement-transform';
import {parseObj} from '../../apps/desktop/main/surface';
const oriented=(cx:number,cy:number,angle:number,length:number,width:number)=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([i,j])=>({xMm:cx+i*Math.cos(angle)*length/2-j*Math.sin(angle)*width/2,yMm:cy+i*Math.sin(angle)*length/2+j*Math.cos(angle)*width/2}));
function terminalFixture(view:'front'|'back',axisFlip=false,sourceAngle?:number){
 const p=project(),sign=view==='front'?1:-1,side=view==='front'?'left':'right',modelSide=view==='front'?'right':'left',angle=sourceAngle??(view==='front'?1.1:-.8),targetAngle=-.2,referenceId=randomUUID(),paw=oriented(240,50,targetAngle,80,30),arm=oriented(150,80,targetAngle,70,30);
 p.surface=parseObj([...paw.concat(arm).map(v=>`v ${sign*v.xMm} ${v.yMm} 0`),'g palm-'+modelSide,'f 1 2 3','f 1 3 4','g arm-'+modelSide,'f 5 6 7','f 5 7 8'].join('\n'));p.surface.source='species-template-1';
 const at=(u:number,v=0)=>({xMm:Math.cos(angle)*u-Math.sin(angle)*v,yMm:Math.sin(angle)*u+Math.cos(angle)*v}),pieces=[[60,0,30,30,'#eeeeee'],[83,-9,8,8,'#080808'],[83,9,8,8,'#080808']].map(([u,v,w,h,color])=>{const c=at(u as number,v as number),piece=rectangle();piece.color=color as string;piece.nodes=oriented(c.xMm,c.yMm,angle,w as number,h as number).map(v=>({...v,id:randomUUID()}));return piece;}),points=pieces.flatMap(s=>s.nodes),xs=points.map(v=>150+v.xMm),ys=points.map(v=>150-v.yMm);
 p.patternLibrary=pieces.map(piece=>({piece,referenceId,view,category:'paw',anatomy:{part:'paw',side,confidence:.78,method:'silhouette-1'}}));p.references=[{id:referenceId,name:'Neutral terminal hand',view,width:300,height:300,png:'data:image/png;base64,AA==',calibration:{a:{x:150,y:150},b:{x:150,y:50},distanceMm:100},illustration:{algorithm:'illustration-2',subject:'character',bounds:{minX:0,minY:0,maxX:300,maxY:300},partBounds:[{part:'arm',side,orientationRad:-angle+(axisFlip?Math.PI:0),bounds:{minX:140,minY:140,maxX:160,maxY:160}},{part:'paw',side,orientationRad:angle+Math.PI/2,bounds:{minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys)}}],foregroundPixels:1028,discardedPixels:0,palette:['#eeeeee','#080808'],smoothingPx:0}}];
 return {p,angle,targetAngle,at};
}
it.each([['front',false],['front',true],['back',false],['back',true]] as const)('directs the %s terminal paw from its adjacent arm even when the PCA axis is reversed=%s', (view,axisFlip)=>{
 const {p,angle,targetAngle,at}=terminalFixture(view,axisFlip),placements=p.patternLibrary!.map(s=>anatomicalPlacement(p,s)),placement=placements[0];expect(placement.rotationRad).toBeCloseTo(targetAngle-angle,10);expect(placements.every(r=>JSON.stringify(r)===JSON.stringify(placement))).toBe(true);expect(placement.scaleX).toBe(placement.scaleY);
 const palm=placedPoint(at(60),placement),tip=placedPoint(at(83),placement);expect(tip.xMm).toBeGreaterThan(palm.xMm);expect(tip.yMm).toBeLessThan(palm.yMm);
 const before=structuredClone(placement);p.references![0].illustration!.partBounds.push({part:'body',bounds:{minX:500,minY:-1000,maxX:1000,maxY:-500}});expect(anatomicalPlacement(p,p.patternLibrary![0])).toEqual({...before,sourceGroupHash:anatomicalPlacement(p,p.patternLibrary![0]).sourceGroupHash});
});
it.each([['front',Math.PI/2-.0001],['back',Math.PI/2+.0001],['front',-Math.PI/2-.0001],['back',-Math.PI/2+.0001]] as const)('retains the distal %s paw direction across the near-vertical arm boundary %s',(view,angle)=>{
 const {p,at}=terminalFixture(view,false,angle),placement=anatomicalPlacement(p,p.patternLibrary![0]),palm=placedPoint(at(60),placement),tip=placedPoint(at(83),placement);expect(tip.xMm).toBeGreaterThan(palm.xMm);expect(tip.yMm).toBeLessThan(palm.yMm);
});
it.each(['colored-pad','manual','imported-model','missing-arm-frame','missing-target-arm','one-tip','duplicate-tip','low-confidence'] as const)('retains established unrotated paw fitting for %s without independent terminal-hand support',kind=>{
 const {p}=terminalFixture('front');if(kind==='colored-pad')p.patternLibrary![1].piece.color='#ffaabb';if(kind==='manual')for(const s of p.patternLibrary!){s.anatomy!.method='manual';s.anatomy!.side='right';}if(kind==='missing-arm-frame')p.references![0].illustration!.partBounds=p.references![0].illustration!.partBounds.filter(b=>b.part!=='arm');if(kind==='missing-target-arm')p.surface!.faces=p.surface!.faces.filter(f=>!f.region.startsWith('arm-'));if(kind==='one-tip')p.patternLibrary!.pop();if(kind==='low-confidence')p.patternLibrary![0].anatomy!.confidence=.4;
 if(kind==='duplicate-tip')p.patternLibrary![2].piece.id=p.patternLibrary![1].piece.id;if(kind==='imported-model'){p.surface!.source='obj';for(const s of p.patternLibrary!)s.anatomy!.side='right';}
 expect(anatomicalPlacement(p,p.patternLibrary![0]).rotationRad).toBe(0);
});

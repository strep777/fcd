import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {project,rectangle} from '../fixtures';
import {anatomicalPlacement} from '../../apps/desktop/main/anatomical-placement';
import {placedPoint} from '../../packages/reference/placement-transform';
import {parseObj} from '../../apps/desktop/main/surface';
function oriented(cx:number,cy:number,angle:number,length:number,width:number){const a={x:Math.cos(angle),y:Math.sin(angle)},b={x:-a.y,y:a.x};return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([i,j])=>({xMm:cx+i*a.x*length/2+j*b.x*width/2,yMm:cy+i*a.y*length/2+j*b.y*width/2}));}
function armFixture(view:'front'|'back',raised=false,vertical=false){
 const p=project();p.pieces=[];const target=oriented(200,50,-.2,180,30),sign=view==='front'?1:-1;
 p.surface=parseObj([...target.map(v=>`v ${v.xMm} ${v.yMm} 0`),'v -10 -100 0','v 10 -100 0','v 10 100 0','v -10 100 0','g arm-right',sign===1?'f 1 2 3':'f 3 2 1',sign===1?'f 1 3 4':'f 4 3 1','g torso','f 5 6 7','f 5 7 8'].join('\n'));p.surface.source='species-template-1';
 const referenceId=randomUUID(),angle=(raised?(view==='front'?70:110):(vertical?-89.99:(view==='front'?-70:-110)))*Math.PI/180,sourceX=sign*50,frame=oriented(sourceX,20,angle,80,20),piece=rectangle(1,1);piece.nodes=frame.map(v=>({...v,id:randomUUID()}));piece.curves=[];
 const side='left';
 p.references=[{id:referenceId,name:'Posed source',view,width:300,height:300,png:'data:image/png;base64,AA==',calibration:{a:{x:150,y:100},b:{x:150,y:0},distanceMm:100},illustration:{algorithm:'illustration-2',subject:'character',bounds:{minX:0,minY:0,maxX:300,maxY:300},partBounds:[{part:'body',bounds:{minX:140,minY:0,maxX:160,maxY:200}},{part:'arm',side,orientationRad:-angle,frameCorners:frame.map(v=>({x:150+v.xMm,y:100-v.yMm})),bounds:{minX:150+sourceX-30,minY:40,maxX:150+sourceX+30,maxY:120}}],foregroundPixels:20000,discardedPixels:0,palette:['#ffffff'],smoothingPx:0}}];
 const source={piece,referenceId,view,category:'character',anatomy:{part:'arm',side,confidence:1,method:'silhouette-1'}} as NonNullable<typeof p.patternLibrary>[number];p.patternLibrary=[source];
 return {p,source,angle,sourceX,sign};
}
for(const raised of [false,true])it.each(['front','back'] as const)(`${raised?'raised':'downward'} angled %s arm preserves shoulder → cuff → hand order above the torso midpoint`,view=>{
 const {p,source,angle,sourceX,sign}=armFixture(view,raised),placement=anatomicalPlacement(p,source),at=(distance:number)=>placedPoint({xMm:sourceX+distance*Math.cos(angle),yMm:20+distance*Math.sin(angle)},placement),shoulder=at(-30),cuff=at(15),wrist=at(30);
 expect(sign*cuff.xMm,'cuff must be farther from the torso than the shoulder').toBeGreaterThan(sign*shoulder.xMm);expect(sign*wrist.xMm,'hand must be beyond its cuff, never at the upper arm').toBeGreaterThan(sign*cuff.xMm);expect(wrist.yMm).toBeLessThan(shoulder.yMm);expect(placement.scaleX).toBe(placement.scaleY);
});
it.each(['front','back'] as const)('near vertical %s arm retains its downwards fallback without a stable lateral axis',view=>{const {p,source,angle,sourceX,sign}=armFixture(view,false,true),placement=anatomicalPlacement(p,source),at=(d:number)=>placedPoint({xMm:sourceX+d*Math.cos(angle),yMm:20+d*Math.sin(angle)},placement);expect(sign*at(30).xMm).toBeGreaterThan(sign*at(-30).xMm);});

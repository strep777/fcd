import {expect,it} from 'vitest';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {parseObj} from '../../apps/desktop/main/surface';
it('real-mapping coverage audit unions repeated face fragments and subtracts holes instead of counting touched triangles',async()=>{
 const {mappingCoverage}=await import(pathToFileURL(resolve('tests/real-mapping-coverage-audit.mjs')).href),p=project();p.surface=parseObj('v 0 0 0\nv 10 0 0\nv 0 10 0\ng torso\nf 1 2 3');
 const fragment={faceId:p.surface.faces[0].id,rings:[[[1,0,0],[0,1,0],[0,0,1]],[[.6,.2,.2],[.2,.2,.6],[.2,.6,.2]]]};
 p.markings=[{view:'front',color:'#fff',fragments:[fragment]},{view:'front',color:'#fff',fragments:[structuredClone(fragment)]}] as any;
 const rows=mappingCoverage(p,resolve('target/release/fpcad-worker.exe')),front=rows.find((r:any)=>r.view==='front'&&r.region==='torso');expect(front.visibleProjectedAreaMm2).toBe(50);expect(front.colors['#fff']).toBeCloseTo(42,8);
});
import sharp from 'sharp';
import {rectangle} from '../fixtures';
import {randomUUID} from 'node:crypto';
it('actual-pigment audit rejects a tiny fragment despite a valid source and a touched target face',async()=>{
 const {assertActualPigmentFeatures}=await import(pathToFileURL(resolve('tests/real-mapping-coverage-audit.mjs')).href),p=project(),source=rectangle(10,10),referenceId=randomUUID(),png='data:image/png;base64,'+(await sharp({create:{width:10,height:10,channels:4,background:'#123456'}}).png().toBuffer()).toString('base64');source.color='#123456';p.surface=parseObj('v 0 0 0\nv 10 0 0\nv 0 10 0\ng leg-right\nf 1 2 3');p.references=[{id:referenceId,view:'front',width:10,height:10,png,calibration:{a:{x:0,y:10},b:{x:0,y:0},distanceMm:10}}] as any;p.patternLibrary=[{piece:source,referenceId,view:'front',category:'leg'}];
 const mark={sourcePieceId:source.id,view:'front',color:source.color,placement:{part:'leg',side:'left',scaleX:1,scaleY:1},fragments:[{faceId:p.surface.faces[0].id,rings:[[[1,0,0],[0,1,0],[0,0,1]]]}]};p.markings=[mark] as any;
 const helpers={illustrationRegions:()=>({regions:[{color:source.color,indices:Array.from({length:100},(_,i)=>i)}]})},features=[{view:'front',x:3,y:3,part:'leg',side:'left',color:source.color,pixels:100}];
 expect((await assertActualPigmentFeatures(p,resolve('target/release/fpcad-worker.exe'),helpers,features))[0].visibleAreaFraction).toBeCloseTo(.5);
 mark.fragments[0].rings=[[[1,0,0],[.9,.1,0],[.9,0,.1]]];await expect(assertActualPigmentFeatures(p,resolve('target/release/fpcad-worker.exe'),helpers,features)).rejects.toThrow('substantial projected feature');
});

function cuffProject(){
 const p:any=project();p.surface={vertices:[],faces:[]};p.patternLibrary=[];p.references=[];p.markings=[];
 const triangle=(region:string,left:number,right:number,sign=1)=>{const ids=[[left,-10],[right,-10],[left,10]].map(([x,y])=>{const id=randomUUID();p.surface.vertices.push({id,xMm:sign*x,yMm:y,zMm:0});return id;}),face={id:randomUUID(),region,vertices:ids};p.surface.faces.push(face);return face;};
 triangle('torso',-20,20);triangle('torso',20,-20);
 for(const view of ['front','back']){
  const back=view==='back',side=back?'right':'left',modelSide=back?'left':'right',sign=back?-1:1,referenceId=randomUUID(),armRegion='arm-'+modelSide,blue=triangle(armRegion,20,40,sign),yellow=triangle(armRegion,90,110,sign);triangle(armRegion,110,120,sign);
  const hand=triangle('palm-'+modelSide,125,155,sign),claw1=triangle('finger-'+modelSide+'-0',160,180,sign),claw2=triangle('hand-claw-'+modelSide+'-1',185,205,sign),pawRegions=[hand,claw1,claw2].map(f=>f.region),sources=Array.from({length:back?46:56},()=>({piece:rectangle(),view,referenceId}));
  p.references.push({id:referenceId,view,calibration:{a:{x:0,y:10},b:{x:0,y:0},distanceMm:1}});
  const attach=(index:number,color:string,part:string,face:any)=>{const source=sources[index];source.piece.color=color;Object.assign(source,{anatomy:{part,side}});p.markings.push({sourcePieceId:source.piece.id,view,color,placement:{part,side,modelSide,regions:part==='arm'?[armRegion]:pawRegions,scaleX:1,scaleY:1},fragments:[{faceId:face.id,rings:[[[1,0,0],[0,1,0],[0,0,1]]]}]});};
  attach(0,back?'#02a6f4':'#04a3f0','arm',blue);attach(back?26:24,back?'#f7e13c':'#f9e33c','arm',yellow);attach(back?2:7,back?'#dcd0d7':'#ede7ea','paw',hand);attach(back?37:47,back?'#080608':'#08060a','paw',claw1);attach(back?38:48,back?'#080608':'#08060a','paw',claw2);p.patternLibrary.push(...sources);
 }
 return p;
}
const cuffAudit=async()=> (await import(pathToFileURL(resolve('tests/real-mapping-coverage-audit.mjs')).href)).assertJpegCuffOrder;
it('JPEG cuff audit measures both original paw claws and neutral palms on the existing arm axis with signed front/back species sides',async()=>{
 const audit=await cuffAudit(),p=cuffProject(),checks=audit(p);expect(checks.map((c:any)=>[c.view,c.side,c.modelSide])).toEqual([['front','left','right'],['back','right','left']]);
 for(const check of checks){const paws=check.rows.filter((r:any)=>r.part==='paw');expect(paws).toHaveLength(3);expect(paws.every((r:any)=>r.station>1&&r.visibleAreaFraction>.3)).toBe(true);expect(paws.map((r:any)=>r.sourcePixels)).toEqual(check.view==='front'?[2340,251,111]:[2722,255,142]);}
 const before=checks.map((c:any)=>c.rows.filter((r:any)=>r.part==='arm').map((r:any)=>r.station));for(const v of p.surface.vertices)if(Math.abs(v.xMm)>120)v.xMm*=3;const after=audit(p).map((c:any)=>c.rows.filter((r:any)=>r.part==='arm').map((r:any)=>r.station));expect(after).toEqual(before);
});
it.each(['old-arm-metadata','old-arm-placement','wrong-source-side','wrong-model-side','wrong-target-region','forearm-fragment','missing-second-claw','different-claw-source','tiny-hand','tiny-claw','hand-on-finger','reversed-cuff'] as const)('JPEG cuff audit rejects %s despite matching original pigment colors',async kind=>{
 const audit=await cuffAudit(),p=cuffProject(),hand=p.markings[2],claw=p.markings[4],yellow=p.markings[1],source=p.patternLibrary[7];
 if(kind==='old-arm-metadata')source.anatomy.part='arm';
 if(kind==='old-arm-placement')hand.placement.part='arm';
 if(kind==='wrong-source-side')source.anatomy.side='right';
 if(kind==='wrong-model-side')claw.placement.modelSide='left';
 if(kind==='wrong-target-region')claw.placement.regions=['palm-left'];
 if(kind==='forearm-fragment')claw.fragments[0].faceId=yellow.fragments[0].faceId;
 if(kind==='missing-second-claw')p.markings.splice(4,1);
 if(kind==='different-claw-source')claw.sourcePieceId=p.patternLibrary[49].piece.id;
 if(kind==='tiny-hand'||kind==='tiny-claw')(kind==='tiny-hand'?hand:claw).fragments[0].rings=[[[1,0,0],[.99,.01,0],[.99,0,.01]]];
 if(kind==='hand-on-finger')hand.fragments[0].faceId=p.markings[3].fragments[0].faceId;
 if(kind==='reversed-cuff')yellow.fragments[0].faceId=p.markings[0].fragments[0].faceId;
 expect(()=>audit(p)).toThrow();
});

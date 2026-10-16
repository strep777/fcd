import {randomUUID} from 'node:crypto';
import {speciesParamsSchema,surfaceSchema,type SpeciesParams,type Surface} from '../../../packages/schema/index';
import {DomainError} from './repository';
import {validateSurface} from './surface';
import {smoothSections,sweepFrame,type LoftSection,type Vector3} from './species-loft';
export {speciesDefaults} from '../../../packages/body/defaults';

/** Original measured fursuit recipes. Assembly removes overlaps to expose one closed exterior. */
export function generateSpecies(raw:SpeciesParams,previous?:Surface):Surface{
 const p=speciesParamsSchema.parse(raw),vertices:Surface['vertices']=[],faces:Surface['faces']=[],parts:string[]=[],measurements:{name:string;targetMm:number;actualMm:number;residualMm:number}[]=[];
 const vertex=(position:Vector3)=>{vertices.push({id:randomUUID(),xMm:position[0],yMm:position[1],zMm:position[2]});return vertices.length-1;};
 const face=(a:number,b:number,c:number,region:string)=>{if(a!==b&&b!==c&&c!==a)faces.push({id:randomUUID(),vertices:[a,b,c].map(i=>vertices[i].id) as [string,string,string],region});};
 const measure=(name:string,targetMm:number,actualMm:number)=>measurements.push({name,targetMm,actualMm,residualMm:actualMm-targetMm});
 const ringLength=(ring:number[])=>ring.reduce((sum,id,i)=>{const a=vertices[id],b=vertices[ring[(i+1)%ring.length]];return sum+Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm);},0);
 const pad=p.paddingMm+p.layerMm;
 const tube=(name:string,controls:LoftSection[],axis:'x'|'y'|'z'='y',n=16,steps=2,padded=true)=>{
  parts.push(name);const sections=smoothSections(controls,steps),rings:number[][]=[];
  for(const [i,section] of sections.entries()){
   if(section.girth===0){rings.push(Array(n).fill(vertex(section.center)) as number[]);continue;}
   const ratio=section.ratio??1,unit=Array.from({length:n},(_,j)=>[Math.cos(j*2*Math.PI/n),ratio*Math.sin(j*2*Math.PI/n)]);
   const perimeter=unit.reduce((sum,a,j)=>{const b=unit[(j+1)%n];return sum+Math.hypot(a[0]-b[0],a[1]-b[1]);},0),radius=section.girth/perimeter;
   const [u,v]=sweepFrame(sections,i,axis);
   rings.push(unit.map(([a,b])=>{const normal=Math.hypot(a,b/ratio**2),padding=padded?pad:0,x=a*radius+padding*a/normal,y=b*radius+padding*b/ratio**2/normal;return vertex(section.center.map((c,k)=>c+x*u[k]+y*v[k]) as Vector3);}));
  }
  // X/Z sweep frames are right-handed; horizontal Y rings have the opposite handedness.
  const direction=sections.at(-1)!.center[1]-sections[0].center[1],reverse=axis==='y'&&direction<0;
  const emit=(a:number,b:number,c:number,region:string)=>reverse?face(a,c,b,region):face(a,b,c,region);
  for(let i=0;i<rings.length-1;i++)for(let j=0;j<n;j++){
   const a=rings[i][j],b=rings[i][(j+1)%n],c=rings[i+1][j],d=rings[i+1][(j+1)%n],region=name+'-'+Math.floor(j/(n/4));
   if(axis==='y'){emit(a,c,b,region);emit(b,c,d,region);}else{emit(a,b,c,region);emit(b,d,c,region);}
  }
  for(const [ring,start] of [[rings[0],true],[rings.at(-1)!,false]] as const){
   if(new Set(ring).size===1)continue;const center=vertex(sections[start?0:sections.length-1].center);
   for(let j=0;j<n;j++){const a=ring[j],b=ring[(j+1)%n];if((axis==='y')===start)emit(center,a,b,name+(start?'-cap-start':'-cap-end'));else emit(center,b,a,name+(start?'-cap-start':'-cap-end'));}
  }
  return controls.map((_,i)=>rings[i*steps]);
 };
 const ellipsoid=(name:string,center:Vector3,radii:Vector3,n=16,latitudes=8)=>{
  parts.push(name);const rings:number[][]=[];
  for(let i=1;i<latitudes;i++){const theta=i*Math.PI/latitudes;rings.push(Array.from({length:n},(_,j)=>{const a=j*2*Math.PI/n;return vertex([center[0]+radii[0]*Math.sin(theta)*Math.cos(a),center[1]+radii[1]*Math.cos(theta),center[2]+radii[2]*Math.sin(theta)*Math.sin(a)]);}));}
  for(let i=0;i<rings.length-1;i++)for(let j=0;j<n;j++){const a=rings[i][j],b=rings[i][(j+1)%n],c=rings[i+1][j],d=rings[i+1][(j+1)%n];face(a,b,c,name+'-'+Math.floor(j/(n/4)));face(b,d,c,name+'-'+Math.floor(j/(n/4)));}
  const top=vertex([center[0],center[1]+radii[1],center[2]]),bottom=vertex([center[0],center[1]-radii[1],center[2]]);
  for(let j=0;j<n;j++){face(top,rings[0][(j+1)%n],rings[0][j],name+'-top');face(bottom,rings.at(-1)![j],rings.at(-1)![(j+1)%n],name+'-bottom');}
 };
 const h=p.heightMm,hip=p.legLengthMm,neckY=h-p.earHeightMm-p.headLengthMm,shoulderY=neckY-70,torsoHeight=shoulderY-hip;
 if(torsoHeight<150)throw new DomainError('INCOMPATIBLE_BODY_PROPORTIONS');
 const circumference=(ratio:number,n=24)=>Array.from({length:n},(_,i)=>{const a=i*2*Math.PI/n,b=(i+1)*2*Math.PI/n;return Math.hypot(Math.cos(a)-Math.cos(b),ratio*(Math.sin(a)-Math.sin(b)));}).reduce((a,b)=>a+b,0);
 const torso=tube('torso',[
  {center:[0,hip-torsoHeight*.18,0],girth:p.hipGirthMm*.60,ratio:.75},
  {center:[0,hip,0],girth:p.hipGirthMm,ratio:.75},
  {center:[0,hip+torsoHeight*.35,0],girth:p.waistGirthMm,ratio:.72},
  {center:[0,hip+torsoHeight*.8,0],girth:p.chestGirthMm,ratio:.72},
  {center:[0,shoulderY-45,0],girth:p.shoulderWidthMm/2*circumference(.65),ratio:.65},
  {center:[0,shoulderY,0],girth:p.shoulderWidthMm*.46*circumference(.65),ratio:.65},
  {center:[0,shoulderY+40,0],girth:p.shoulderWidthMm*.32*circumference(.72),ratio:.72},
  {center:[0,neckY-15,0],girth:p.neckGirthMm*1.15,ratio:.85},
  {center:[0,neckY,0],girth:p.neckGirthMm,ratio:.85},
  {center:[0,neckY+p.headLengthMm*.18,0],girth:p.neckGirthMm*.9,ratio:.85}
 ],'y',24,4);
 for(const [index,name,target] of [[1,'hipGirth',p.hipGirthMm],[2,'waistGirth',p.waistGirthMm],[3,'chestGirth',p.chestGirthMm],[8,'neckGirth',p.neckGirthMm]] as const)measure(name,target+pad*2*Math.PI,ringLength(torso[index]));
 const headCenterY=neckY+p.headLengthMm/2,headStart=vertices.length;
 ellipsoid('head',[0,headCenterY,0],[p.headWidthMm/2,p.headLengthMm/2,p.headLengthMm*(p.species==='bear'?.46:.43)],24,10);
 const headVertices=vertices.slice(headStart);measure('headWidth',p.headWidthMm,Math.max(...headVertices.map(v=>v.xMm))-Math.min(...headVertices.map(v=>v.xMm)));measure('headHeight',p.headLengthMm,Math.max(...headVertices.map(v=>v.yMm))-Math.min(...headVertices.map(v=>v.yMm)));
 const muzzleY=headCenterY-p.headLengthMm*.15,muzzleEnd=p.headLengthMm*.42+p.snoutLengthMm;
 tube('snout',[
  {center:[0,muzzleY,p.headLengthMm*.20],girth:p.snoutWidthMm*3,ratio:.75},
  {center:[0,muzzleY-p.headLengthMm*.025,p.headLengthMm*.4+p.snoutLengthMm*.55],girth:p.snoutWidthMm*2.7,ratio:.65},
  {center:[0,muzzleY,muzzleEnd],girth:p.snoutWidthMm*2.2,ratio:.65},
  {center:[0,muzzleY,muzzleEnd+p.snoutWidthMm*.1],girth:p.snoutWidthMm*.8,ratio:.65}
 ],'z',16,2,false);
 for(const side of [-1,1]){
  const suffix=side<0?'left':'right',earX=side*p.headWidthMm*(p.species==='bear'?.27:.31);
  if(p.species==='bear')ellipsoid('ear-'+suffix,[earX,h-p.earHeightMm*.8,0],[p.earWidthMm/2,p.earHeightMm*.8,p.earWidthMm*.3],16,8);
  else tube('ear-'+suffix,[
   {center:[earX,h-p.earHeightMm-p.headLengthMm*.2,0],girth:p.earWidthMm*2.5,ratio:.28},
   {center:[earX+side*Math.sin(p.earAngleRad)*p.earHeightMm*.25,h-p.earHeightMm*.68,0],girth:p.earWidthMm*(p.species==='rabbit'?2.5:2.0),ratio:.24},
   {center:[earX+side*Math.sin(p.earAngleRad)*p.earHeightMm*.75,h-p.earHeightMm*.2,0],girth:p.earWidthMm*(p.species==='rabbit'?1.8:.9),ratio:.20},
   {center:[earX+side*Math.sin(p.earAngleRad)*p.earHeightMm,h,0],girth:0,ratio:.2}
  ],'y',12,2,false);
  const wrist:Vector3=[side*(p.shoulderWidthMm/2+p.armLengthMm),shoulderY-p.armLengthMm*.5,0];
  const arm=tube('arm-'+suffix,[
   {center:[side*p.shoulderWidthMm*.25,shoulderY-20,0],girth:p.upperArmGirthMm*.92},
   {center:[side*p.shoulderWidthMm*.50,shoulderY-35,0],girth:p.upperArmGirthMm},
   {center:[side*(p.shoulderWidthMm/2+p.armLengthMm*.3),shoulderY-p.armLengthMm*.16,0],girth:p.upperArmGirthMm*.94},
   {center:[side*(p.shoulderWidthMm/2+p.armLengthMm*.65),shoulderY-p.armLengthMm*.33,0],girth:p.forearmGirthMm*1.08},
   {center:wrist,girth:p.forearmGirthMm}
  ],'x',16,4);
  measure('upperArmGirth-'+suffix,p.upperArmGirthMm+pad*2*Math.PI,ringLength(arm[1]));measure('forearmGirth-'+suffix,p.forearmGirthMm+pad*2*Math.PI,ringLength(arm[4]));
  ellipsoid('palm-'+suffix,[wrist[0]+side*p.pawLengthMm*.30,wrist[1]-p.pawLengthMm*.13,0],[p.pawLengthMm*.43,p.pawWidthMm*.29,p.pawWidthMm*.5]);
  ellipsoid('palm-pad-'+suffix,[wrist[0]+side*p.pawLengthMm*.3,wrist[1]-p.pawWidthMm*.3,0],[p.pawLengthMm*.27,p.pawWidthMm*.08,p.pawWidthMm*.29],12,6);
  const legX=side*Math.max(p.thighGirthMm/(2*Math.PI)+8,p.hipGirthMm*.088),ankleY=p.footLengthMm*.38;
  const kneeZ=p.legType==='digitigrade'?p.footLengthMm*.28:p.footLengthMm*.07,hockZ=p.legType==='digitigrade'?-p.footLengthMm*.25:0;
  const leg=tube('leg-'+suffix,[
   {center:[legX*.68,hip+torsoHeight*.14,0],girth:p.thighGirthMm*.60,ratio:1.04},
   {center:[legX,hip*.86,p.footLengthMm*.05],girth:p.thighGirthMm,ratio:1.08},
   {center:[legX,hip*.62,kneeZ],girth:p.thighGirthMm*.91,ratio:1.12},
   {center:[legX,hip*.40,kneeZ*.25+hockZ*.75],girth:p.shinGirthMm*.86,ratio:1.0},
   {center:[legX,hip*.26,hockZ],girth:p.shinGirthMm,ratio:1.0},
   {center:[legX,ankleY,0],girth:p.shinGirthMm*.83,ratio:1.0}
  ],'y',20,4);
  measure('thighGirth-'+suffix,p.thighGirthMm+pad*2*Math.PI,ringLength(leg[1]));measure('shinGirth-'+suffix,p.shinGirthMm+pad*2*Math.PI,ringLength(leg[4]));
  ellipsoid((p.species==='deer'?'hoof-':'foot-')+suffix,[legX,p.footLengthMm*.25,p.footLengthMm*.30],[p.pawWidthMm*.74,p.footLengthMm*.25,p.footLengthMm*.46],20,8);
  const digits=p.species==='deer'?2:4;
  for(let digit=0;digit<digits;digit++){
   const z=(digit-(digits-1)/2)*p.pawWidthMm/(digits+.5),x=(digit-(digits-1)/2)*p.pawWidthMm/(digits+.5),fingerY=wrist[1]-p.pawLengthMm*.23;
   ellipsoid('finger-'+suffix+'-'+digit,[wrist[0]+side*p.pawLengthMm*.66,fingerY,z],[p.pawLengthMm*.28,p.pawWidthMm/(digits*2.3),p.pawWidthMm/(digits*2.3)],8,4);
   ellipsoid('toe-'+suffix+'-'+digit,[legX+x,p.footLengthMm*.18,p.footLengthMm*.68],[p.pawWidthMm/(digits*1.65),p.footLengthMm*.15,p.footLengthMm*.21],8,4);
   if(p.clawLengthMm>0){
    tube('hand-claw-'+suffix+'-'+digit,[{center:[wrist[0]+side*p.pawLengthMm*.88,fingerY,z],girth:p.clawLengthMm*1.25},{center:[wrist[0]+side*(p.pawLengthMm*.94+p.clawLengthMm),fingerY-p.clawLengthMm*.18,z],girth:0}],'x',8,1,false);
    tube('foot-claw-'+suffix+'-'+digit,[{center:[legX+x,p.footLengthMm*.18,p.footLengthMm*.83],girth:p.clawLengthMm*1.25},{center:[legX+x,p.footLengthMm*.14,p.footLengthMm*.87+p.clawLengthMm],girth:0}],'z',8,1,false);
   }
  }
  if(p.species==='deer'||p.species==='dragon')tube('horn-'+suffix,[{center:[side*p.headWidthMm*.23,h-p.earHeightMm-p.headLengthMm*.18,-p.headLengthMm*.12],girth:p.headWidthMm*.36},{center:[side*p.headWidthMm*.28,h-p.earHeightMm*.42,-p.headLengthMm*.25],girth:p.headWidthMm*.18},{center:[side*p.headWidthMm*.33,h,-p.headLengthMm*.32],girth:0}],'y',12,2,false);
  if(p.species==='dragon'){
   // Folded curved membrane has finite thickness and a root inside the back.
   const name='wing-'+suffix,outline:Vector3[]=[
    [side*p.shoulderWidthMm*.12,shoulderY-55,-p.chestGirthMm*.065],
    [side*p.shoulderWidthMm*.45,shoulderY-30,-p.chestGirthMm*.19],
    [side*p.shoulderWidthMm*.84,shoulderY-torsoHeight*.35,-p.chestGirthMm*.26],
    [side*p.shoulderWidthMm*.72,hip+torsoHeight*.35,-p.chestGirthMm*.23],
    [side*p.shoulderWidthMm*.42,hip+torsoHeight*.16,-p.hipGirthMm*.18],
    [side*p.shoulderWidthMm*.10,hip+torsoHeight*.10,-p.hipGirthMm*.06]
   ];parts.push(name);
   const front=outline.map(v=>vertex([v[0],v[1],v[2]+4])),back=outline.map(v=>vertex([v[0],v[1],v[2]-4]));
   const center=outline.reduce((sum,v)=>sum.map((n,i)=>n+v[i]/outline.length) as Vector3,[0,0,0] as Vector3),a=vertex([center[0],center[1],center[2]+14]),b=vertex([center[0],center[1],center[2]-14]);
   for(let j=0;j<outline.length;j++){const next=(j+1)%outline.length;face(a,front[j],front[next],name);face(b,back[next],back[j],name);face(front[j],back[j],back[next],name);face(front[j],back[next],front[next],name);}
  }
 }
 if(p.tailLengthMm>0){
  const centers=Array.from({length:13},(_,i)=>{const t=i/12;return [p.tailCurvature*p.tailLengthMm*.16*Math.sin(Math.PI*t),-p.tailLengthMm*.75*Math.sin(Math.PI*t/2),-p.tailLengthMm*.90*t] as Vector3;});
  const length=centers.slice(1).reduce((sum,v,i)=>sum+Math.hypot(...v.map((n,j)=>n-centers[i][j])),0),factor=p.tailLengthMm/length;
  tube('tail',centers.map((c,i)=>{const t=i/12;return {center:[c[0]*factor,hip+torsoHeight*.30+c[1]*factor,-p.hipGirthMm*.07+c[2]*factor],girth:p.tailBaseGirthMm+(p.tailTipGirthMm-p.tailBaseGirthMm)*t**.85};}),'z',16,1);
  measure('tailCenterlineLength',p.tailLengthMm,length*factor);
 }
 measure('height',h,Math.max(...vertices.map(v=>v.yMm))-Math.min(...vertices.map(v=>v.yMm)));
 if(Math.abs(measurements.at(-1)!.residualMm)>1)throw new DomainError('INCOMPATIBLE_BODY_PROPORTIONS');
 const stable=previous?.source==='species-template-1'&&!previous.assembly&&previous.template?.parameters.species===p.species&&previous.template.parameters.legType===p.legType&&previous.vertices.length===vertices.length&&previous.faces.length===faces.length&&JSON.stringify(previous.template.parts)===JSON.stringify(parts);
 if(stable){const ids=new Map(vertices.map((v,i)=>[v.id,previous!.vertices[i].id]));vertices.forEach((v,i)=>v.id=previous!.vertices[i].id);faces.forEach((f,i)=>{f.id=previous!.faces[i].id;f.vertices=f.vertices.map(id=>ids.get(id)!) as [string,string,string];});}
 const result=surfaceSchema.parse({id:stable?previous!.id:randomUUID(),topologyVersion:stable?previous!.topologyVersion+1:1,source:'species-template-1',vertices,faces,cutConstraints:stable?previous!.cutConstraints:undefined,template:{id:'original-'+p.species+'-'+p.legType,version:'1.1.0',license:'original-project-source',parameters:p,parts,measurements,warnings:['MODULAR_SHELL_JOINTS_REQUIRE_REVIEW','PADDING_MEASUREMENTS_ARE_DISCRETIZED','MANUFACTURING_TRIAL_REQUIRED']}});
 validateSurface(result);return result;
}

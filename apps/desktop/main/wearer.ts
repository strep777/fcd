import {randomUUID} from 'node:crypto';
import {surfaceSchema,type SpeciesParams,type Surface} from '../../../packages/schema/index';
import {smoothSections,type LoftSection,type Vector3} from './species-loft';

/** DTD measurements describe the wearer, not the animal silhouette. Padding
 * changes the exterior only; it never moves the wearer's knee or ankle. */
export function generateWearer(p:SpeciesParams):Surface{
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],parts:string[]=[];
 const measurements:{name:string;targetMm:number;actualMm:number;residualMm:number}[]=[];
 const padded=p.bodyMode==='padded',hip=p.legLengthMm,neck=p.heightMm*.86,shoulder=neck-70,torso=shoulder-hip;
 const point=(v:Vector3)=>{const id=randomUUID();vertices.push({id,xMm:v[0],yMm:v[1],zMm:v[2]});return id;};
 const face=(a:string,b:string,c:string,region:string)=>faces.push({id:randomUUID(),vertices:[a,b,c],region});
 const bump=(y:number,low:number,peak:number,high:number)=>{if(y<=low||y>=high)return 0;const t=y<peak?(y-low)/(peak-low):(high-y)/(high-peak);return t*t*(3-2*t);};
 const measurement=(name:string,targetMm:number,actualMm:number)=>measurements.push({name,targetMm,actualMm,residualMm:actualMm-targetMm});
 const tube=(name:string,controls:LoftSection[],axis:'y'|'arm'='y',side=1)=>{
  parts.push(name);const sections=smoothSections(controls,3),n=24,rings:string[][]=[];
  for(const section of sections){
   const ratio=section.ratio??1,unit=Array.from({length:n},(_,j)=>[Math.cos(j*2*Math.PI/n),ratio*Math.sin(j*2*Math.PI/n)]);
   const perimeter=unit.reduce((s,a,j)=>{const b=unit[(j+1)%n];return s+Math.hypot(a[0]-b[0],a[1]-b[1]);},0),r=section.girth/perimeter;
   rings.push(unit.map(([a,b])=>{
    let x=a*r,z=b*r;const y=section.center[1];
    if(padded&&axis==='y'){
     if(name==='torso'){
      const amount=(p.hipPaddingMm??0)*bump(y,hip-torso*.12,hip,hip+torso*.42);
      x+=amount*a;z+=amount*b*.6;
     }else if(name.startsWith('leg-')){
      // Leave the inner thighs clear; the front and outer lobes form the
      // padded shorts silhouette and taper into the actual knee/calf.
      const amount=(p.thighPaddingMm??0)*bump(y,hip*.40,hip*.82,hip*1.18);
      x+=side*amount*Math.max(0,side*a)**2;
      z+=amount*b*(b>=0?1:.65);
      const calf=(p.calfPaddingMm??0)*bump(y,hip*.10,hip*.29,hip*.48);
      x+=calf*a*.55;z+=calf*b;
     }
     if(p.layerMm){x+=p.layerMm*a;z+=p.layerMm*b;}
    }
    return axis==='arm'?point([section.center[0]+side*x*.5,section.center[1]+x*Math.sqrt(.75),section.center[2]+z]):point([section.center[0]+x,y,section.center[2]+z]);
   }));
  }
  // Y rings use clockwise orientation viewed from above. Arm frames have
  // opposite orientation on the left, hence the explicit side winding.
  const reverse=axis==='arm'&&side<0;
  const emit=(a:string,b:string,c:string)=>reverse?face(a,c,b,name):face(a,b,c,name);
  for(let i=0;i+1<rings.length;i++)for(let j=0;j<n;j++){const k=(j+1)%n;emit(rings[i][j],rings[i+1][j],rings[i][k]);emit(rings[i][k],rings[i+1][j],rings[i+1][k]);}
  for(const end of [0,rings.length-1]){const c=point(sections[end].center);for(let j=0;j<n;j++){const k=(j+1)%n;if(end===0)emit(c,rings[end][j],rings[end][k]);else emit(c,rings[end][k],rings[end][j]);}}
  return controls.map((_,i)=>rings[i*3]);
 };
 const ringLength=(ring:string[])=>{const byId=new Map(vertices.map(v=>[v.id,v]));return ring.reduce((s,id,i)=>{const a=byId.get(id)!,b=byId.get(ring[(i+1)%ring.length])!;return s+Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm);},0);};
 const torsoRings=tube('torso',[
  {center:[0,hip-torso*.24,0],girth:p.hipGirthMm*.35,ratio:.78},
  {center:[0,hip,0],girth:p.hipGirthMm,ratio:.78},
  {center:[0,hip+torso*.36,0],girth:p.waistGirthMm,ratio:.72},
  {center:[0,hip+torso*.78,0],girth:p.chestGirthMm,ratio:.72},
  {center:[0,shoulder,0],girth:p.chestGirthMm*.92,ratio:.62},
  {center:[0,neck-25,0],girth:p.neckGirthMm,ratio:.88},
  {center:[0,neck+25,0],girth:p.neckGirthMm,ratio:.88}
 ]);
 for(const [i,name,value] of [[1,'hipGirth',p.hipGirthMm],[2,'waistGirth',p.waistGirthMm],[3,'chestGirth',p.chestGirthMm],[5,'neckGirth',p.neckGirthMm]] as const)measurement(name,value,ringLength(torsoRings[i]));
 // A neutral head locates the wearer's actual height. Ears, muzzle, tail,
 // claws and animal feet do not belong to either DTD or padded underwear.
 const hh=p.heightMm-neck;
 tube('head',Array.from({length:9},(_,i)=>{const t=i/8;return {center:[0,neck+hh*t,0] as Vector3,girth:Math.max(1,p.heightMm*.31*Math.sqrt(Math.max(0,1-(2*t-1)**2))),ratio:1.12};}));
 for(const side of [-1,1]){
  const suffix=side<0?'left':'right',legX=side*p.hipGirthMm*.10;
  tube('leg-'+suffix,[{center:[legX*.7,hip+torso*.16,0],girth:p.thighGirthMm*.65},{center:[legX,hip*.96,0],girth:p.thighGirthMm},{center:[legX,hip*.53,15],girth:p.thighGirthMm*.7},{center:[legX,hip*.43,12],girth:p.shinGirthMm*.86},{center:[legX,hip*.30,0],girth:p.shinGirthMm},{center:[legX,hip*.10,0],girth:p.shinGirthMm*.62}],'y',side);
  tube('foot-'+suffix,[{center:[legX,0,p.footLengthMm*.20],girth:p.footLengthMm*1.5,ratio:2},{center:[legX,hip*.055,p.footLengthMm*.20],girth:p.footLengthMm*1.8,ratio:2},{center:[legX,hip*.12,0],girth:p.shinGirthMm*.60,ratio:1.1}]);
  const arm=p.armLengthMm,ax=p.shoulderWidthMm*.5;
  // Reverse the arm stations to keep the same outward winding as Y lofts.
  tube('arm-'+suffix,[{center:[side*(ax+arm*Math.sqrt(.75)),shoulder-arm*.5,0],girth:p.forearmGirthMm*.65},{center:[side*(ax+arm*.6*Math.sqrt(.75)),shoulder-arm*.3,0],girth:p.forearmGirthMm},{center:[side*ax,shoulder,0],girth:p.upperArmGirthMm},{center:[side*ax*.65,shoulder+10,0],girth:p.upperArmGirthMm*.9}],'arm',side);
  tube('hand-'+suffix,[{center:[side*(ax+(arm+p.pawLengthMm)*Math.sqrt(.75)),shoulder-(arm+p.pawLengthMm)*.5,0],girth:p.forearmGirthMm*.35,ratio:.45},{center:[side*(ax+(arm+p.pawLengthMm*.45)*Math.sqrt(.75)),shoulder-(arm+p.pawLengthMm*.45)*.5,0],girth:p.forearmGirthMm*.9,ratio:.45},{center:[side*(ax+arm*Math.sqrt(.75)),shoulder-arm*.5,0],girth:p.forearmGirthMm*.65,ratio:.8}],'arm',side);
 }
 measurement('height',p.heightMm,p.heightMm);
 return surfaceSchema.parse({id:randomUUID(),topologyVersion:1,source:'species-template-1',vertices,faces,template:{id:'wearer-'+p.bodyMode,version:'1.1.0',license:'original-project-source',parameters:p,parts,measurements,warnings:['MANUFACTURING_TRIAL_REQUIRED']}});
}

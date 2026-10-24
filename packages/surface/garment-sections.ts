import type {Surface} from '../schema/index';
import {orientedPlaneSegments} from './cut-geometry';
import {refineSurface,edgeKey,type FaceCut} from './refine';

/** Start a generated wearable body with a front/back seam through the surface,
 * before topology repair chooses any mesh-edge paths. The seam is geometric:
 * changing triangle diagonals cannot move it. Imported meshes stay manual. */
export function garmentSections(surface:Surface,id:()=>string){
 if(surface.source!=='species-template-1'||!surface.template)return;
 const cuts:FaceCut[]=[];
 try{cuts.push(...orientedPlaneSegments(surface,[0,0,1],0,'garment-front-back'));}catch{return;}
 const p=surface.template.parameters;
 {
  const wearer=p.bodyMode==='dtd'||p.bodyMode==='padded';
  const hip=p.legLengthMm,neck=wearer?p.heightMm*.86:p.heightMm-p.earHeightMm-p.headLengthMm,shoulder=neck-70,torso=shoulder-hip,ax=p.shoulderWidthMm*.5;
  const points=new Map(surface.vertices.map(v=>[v.id,v]));
  const section=(normal:[number,number,number],position:number,name:string,include:(v:Surface['vertices'][number])=>boolean=()=>true)=>{
   const faces=surface.faces.filter(f=>f.vertices.every(id=>include(points.get(id)!)));
   try{cuts.push(...orientedPlaneSegments({...surface,faces},normal,position,name));}catch{/* This joint may be outside a deliberately limited cut scope. */}
  };
  section([0,1,0],neck-10,'garment-neck',v=>Math.abs(v.xMm)<p.neckGirthMm*.4);
  section([0,1,0],hip+torso*.08,'garment-hip');
  section([0,1,0],wearer?hip*.12:p.footLengthMm*.32,'garment-ankle');
  for(const side of [-1,1]){
   section([side,0,0],ax+p.upperArmGirthMm*.025,'garment-shoulder-'+side,v=>v.yMm>shoulder-p.armLengthMm*.75);
   const along=wearer?Math.sqrt(.75):1,normalLength=Math.hypot(along,.5);
   const n:[number,number,number]=[side*along/normalLength,-.5/normalLength,0];
   const center=[side*(ax+p.armLengthMm*.90*along),shoulder-p.armLengthMm*.90*.5,0];
   section(n,n.reduce((sum,v,i)=>sum+v*center[i],0),'garment-wrist-'+side,v=>side*v.xMm>ax);
  }
 }
 const result=refineSurface(surface,cuts,id),edges=[...result.owned.values()].flat();
 if(!edges.length)return;
 result.surface.cutConstraints=[...new Map([...(result.surface.cutConstraints??[]),...edges.map(e=>({...e,locked:true}))].map(e=>[edgeKey(e.a,e.b),e])).values()];
 return result;
}

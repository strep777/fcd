import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createSectionClearance} from '../../packages/surface/section-clearance';
import {orientedPlaneSegments} from '../../packages/surface/cut-geometry';
import {sectionDesignDomain} from '../../packages/surface/design-section';
import type {Surface} from '../../packages/schema/index';
import type {FaceCut} from '../../packages/surface/refine';

function cloth(options:{curved?:boolean;divisions?:number;flip?:boolean;reverse?:boolean;width?:number;height?:number;x?:number;y?:number;z?:number}={}){
 const n=options.divisions??1,nx=5*n,ny=2*n,width=options.width??100,height=options.height??50,vertices:Surface['vertices']=[],faces:Surface['faces']=[];
 for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){
  let px=width*x/nx,pz=0;if(options.curved){const t=x/nx*5,k=Math.min(4,Math.floor(t)),f=t-k,r=150,a=k/5*width/r,b=(k+1)/5*width/r;px=r*((1-f)*Math.sin(a)+f*Math.sin(b));pz=r*(1-(1-f)*Math.cos(a)-f*Math.cos(b));}
  vertices.push({id:randomUUID(),xMm:px+(options.x??0),yMm:y/ny*height+(options.y??0),zMm:pz+(options.z??0)});
 }
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=y*(nx+1)+x,b=a+1,c=a+nx+2,d=a+nx+1;for(const ids of options.flip?[[a,b,d],[b,c,d]]:[[a,b,c],[a,c,d]])faces.push({id:randomUUID(),region:'design:#315579',vertices:ids.map(i=>vertices[i].id) as [string,string,string]});}
 if(options.reverse){vertices.reverse();faces.reverse();}return{id:randomUUID(),source:'obj',topologyVersion:1,vertices,faces} as Surface;
}
function plane(surface:Surface,normal:[number,number,number],position:number){return orientedPlaneSegments(surface,normal,position,'independent physical plane');}
function boundaryCuts(surface:Surface){
 const v=new Map(surface.vertices.map(v=>[v.id,v])),cuts:FaceCut[]=[];
 for(const face of surface.faces){const ends=face.vertices.map((id,i)=>({id,i})).filter(p=>v.get(p.id)!.yMm===0);if(ends.length!==2)continue;const at=(i:number)=>[0,1,2].map(k=>k===i?1:0) as [number,number,number];cuts.push({faceId:face.id,a:at(ends[0].i),b:at(ends[1].i),owner:'existing material boundary'});}return cuts;
}

it.each([false,true])('long 1.47232 mm skimming cuts reject on the same prescribed %s cloth through diagonal flips/refinement/order changes',curved=>{
 for(const options of [{},{flip:true},{divisions:4},{divisions:4,flip:true,reverse:true}]){
  const surface=cloth({...options,curved}),before=structuredClone(surface),cuts=plane(surface,[0,1,0],1.47232);if(options.reverse){cuts.reverse();for(const c of cuts)[c.a,c.b]=[c.b,c.a];}
  expect(cuts.length).toBeGreaterThan(0);expect(createSectionClearance(surface)(cuts)).toBe(false);expect(surface).toEqual(before);
 }
});

it.each([false,true])('ordinary perpendicular boundary crossings and the original collinear edge stay legal (%s curved)',curved=>{
 const surface=cloth({curved,divisions:3,flip:true}),before=structuredClone(surface),accept=createSectionClearance(surface),center=(Math.min(...surface.vertices.map(v=>v.xMm))+Math.max(...surface.vertices.map(v=>v.xMm)))/2;
 expect(accept(plane(surface,[1,0,0],center))).toBe(true);const existing=boundaryCuts(surface);expect(existing.length).toBeGreaterThan(0);expect(accept(existing)).toBe(true);expect(surface).toEqual(before);
});

it('an existing 1.5 mm narrow motif is retained; only a new parallel split is refused',()=>{
 const surface=cloth({height:1.5,divisions:4}),before=structuredClone(surface),accept=createSectionClearance(surface);
 expect(accept(plane(surface,[1,0,0],50))).toBe(true);expect(accept(plane(surface,[0,1,0],.75))).toBe(false);expect(surface).toEqual(before);
 expect(Math.max(...surface.vertices.map(v=>v.yMm))-Math.min(...surface.vertices.map(v=>v.yMm))).toBe(1.5);
});

it('a distant original edge with the same XY projection does not block a valid section 100 mm away in depth',()=>{
 const remote=cloth(),near=cloth({width:200,height:100,x:-50,y:-50,z:100}),combined={...near,vertices:[...near.vertices,...remote.vertices],faces:[...near.faces,...remote.faces]},before=structuredClone(combined);
 expect(createSectionClearance(combined)(plane(near,[0,1,0],1.47232))).toBe(true);expect(combined).toEqual(before);
});

it.each([[1.999,false],[2,true],[2.001,true]] as const)('the prescribed parallel corridor at %s mm follows the strict less-than-2mm boundary',(distance,expected)=>{
 // A short 25 mm boundary isolates the absolute 2 mm gate from the separate
 // wider-corridor aspect-ratio preference introduced for long appendages.
 const surface=cloth({width:25});expect(createSectionClearance(surface)(plane(surface,[0,1,0],distance))).toBe(expected);
});

it.each([false,true])('a new 6.783 mm branch longer than 160 mm rejects while a 20 mm alternative remains legal (%s curved)',curved=>{
 for(const options of [{},{flip:true},{divisions:4},{divisions:4,flip:true,reverse:true}]){
  const surface=cloth({...options,curved,width:240,height:80}),before=structuredClone(surface),accept=createSectionClearance(surface),narrow=plane(surface,[0,1,0],6.783),wide=plane(surface,[0,1,0],20);
  expect(accept(narrow)).toBe(false);expect(accept(wide)).toBe(true);expect(surface).toEqual(before);
 }
});

it.each([false,true])('an original 6.783 mm narrow material stripe and its collinear boundary remain intact (%s curved)',curved=>{
 const surface=cloth({curved,width:240,height:6.783,divisions:4,flip:true}),before=structuredClone(surface),accept=createSectionClearance(surface),center=(Math.min(...surface.vertices.map(v=>v.xMm))+Math.max(...surface.vertices.map(v=>v.xMm)))/2;
 expect(accept(plane(surface,[1,0,0],center))).toBe(true);const existing=boundaryCuts(surface);expect(existing.length).toBeGreaterThan(0);expect(accept(existing),'following a saved material edge creates no new strip').toBe(true);expect(surface).toEqual(before);
});

it.each([false,true])('partial saved-edge traces do not conceal a genuinely new parallel cut (%s curved)',curved=>{
 const surface=cloth({curved,width:240,height:6.783,divisions:2}),before=structuredClone(surface),accept=createSectionClearance(surface),partial=boundaryCuts(surface).map(c=>({...c,a:c.a.map((n,i)=>.75*n+.25*c.b[i]) as [number,number,number],b:c.a.map((n,i)=>.25*n+.75*c.b[i]) as [number,number,number]}));
 expect(partial.length).toBeGreaterThan(0);expect(accept(partial)).toBe(true);expect(accept([...partial,...plane(surface,[0,1,0],1.47232)])).toBe(false);expect(accept([...partial,...plane(surface,[0,1,0],3.3)])).toBe(false);expect(surface).toEqual(before);
});

it('automatic selection can replace a rejected 6.783 mm long branch without trimming the source material',()=>{
 const surface=cloth({width:240,height:80,divisions:2}),before=structuredClone(surface),preferred={normal:[0,1,0] as [number,number,number],position:6.783};expect(createSectionClearance(surface)(plane(surface,preferred.normal,preferred.position))).toBe(false);
 const result=sectionDesignDomain(surface,surface.faces,randomUUID,preferred);expect(result).toBeDefined();expect(Math.hypot(...result!.plane.normal.map((n,i)=>n-preferred.normal[i]))<1e-9&&Math.abs(result!.plane.position-preferred.position)<1e-9).toBe(false);expect(createSectionClearance(surface)(plane(surface,result!.plane.normal,result!.plane.position))).toBe(true);expect(surface).toEqual(before);
});

it('section selection refuses the thin preferred branch and returns a full valid alternative without changing source detail',()=>{
 const surface=cloth({height:5,divisions:2}),before=structuredClone(surface),preferred={normal:[0,1,0] as [number,number,number],position:1.47232};expect(createSectionClearance(surface)(plane(surface,preferred.normal,preferred.position))).toBe(false);
 const result=sectionDesignDomain(surface,surface.faces,randomUUID,preferred);expect(result).toBeDefined();expect(Math.hypot(...result!.plane.normal.map((n,i)=>n-preferred.normal[i]))<1e-9&&Math.abs(result!.plane.position-preferred.position)<1e-9).toBe(false);expect(createSectionClearance(surface)(plane(surface,result!.plane.normal,result!.plane.position))).toBe(true);
 expect(result!.parts.length).toBeGreaterThanOrEqual(2);for(const original of surface.faces){const children=result!.children.get(original.id);if(children)expect(children.reduce((sum,c)=>{const[a,b,d]=c.triangle;return sum+((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]))/1e6;},0)).toBeCloseTo(1,10);}
 expect(surface).toEqual(before);
});

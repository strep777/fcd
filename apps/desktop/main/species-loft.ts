export type Vector3 = [number, number, number];
export type LoftSection = {center:Vector3;girth:number;ratio?:number};

/** Interpolate the silhouette without the radius overshoot that can invert narrow cuffs. */
export function smoothSections(sections:LoftSection[],steps=2):LoftSection[]{
 const result:LoftSection[]=[];
 for(let i=0;i<sections.length-1;i++){
  const a=sections[i],b=sections[i+1],before=sections[Math.max(0,i-1)],after=sections[Math.min(sections.length-1,i+2)];
  for(let j=0;j<steps;j++){
   const t=j/steps,t2=t*t,t3=t2*t,blend=t2*(3-2*t);
   const center=a.center.map((v,axis)=>{
    // Tangents are bounded to keep all axial coordinates monotonic even at the end rings.
    const span=b.center[axis]-v;
    const tangent=(value:number)=>span===0?0:Math.sign(value)===Math.sign(span)?Math.sign(span)*Math.min(Math.abs(value),3*Math.abs(span)):0;
    const m0=tangent((b.center[axis]-before.center[axis])/2),m1=tangent((after.center[axis]-v)/2);
    return (2*t3-3*t2+1)*v+(t3-2*t2+t)*m0+(-2*t3+3*t2)*b.center[axis]+(t3-t2)*m1;
   }) as Vector3;
   result.push({center,girth:a.girth+(b.girth-a.girth)*blend,ratio:(a.ratio??1)+((b.ratio??1)-(a.ratio??1))*blend});
  }
 }
 result.push(sections.at(-1)!);return result;
}

/** A repeatable local frame keeps elliptical sweep rings perpendicular to the centerline. */
export function sweepFrame(sections:LoftSection[],index:number,axis:'x'|'y'|'z'):[Vector3,Vector3]{
 if(axis==='y')return [[1,0,0],[0,0,1]];
 const a=sections[Math.max(0,index-1)].center,b=sections[Math.min(sections.length-1,index+1)].center;
 const delta=b.map((value,i)=>value-a[i]),length=Math.hypot(...delta),t=delta.map(v=>v/length) as Vector3;
 // Arms bend in XY, tails in YZ/XYZ. The fixed reference never approaches parallel for these recipes.
 const reference:Vector3=axis==='x'?[0,0,1]:[1,0,0];
 const cross=(a:Vector3,b:Vector3):Vector3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const u=cross(reference,t),norm=Math.hypot(...u);u.forEach((v,i)=>u[i]=v/norm);
 return [u,cross(t,u)];
}

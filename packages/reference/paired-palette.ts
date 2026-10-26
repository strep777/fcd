import {pigmentFamily} from './illustration';

/** Independent view sampling changes a fabric's RGB under shading. Reconcile
 * only an unambiguous single pigment in each view. Multiple pigments in the
 * same hue family (e.g. a deliberate blue/cyan boundary) stay independent.
 * This operates on a fresh automatic extraction, never on edited sources. */
export function pairedPalette(front:string[],back:string[]){
 const rgb=(color:string)=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),chroma=(p:number[])=>{const sum=p.reduce((s,n)=>s+n,0);return p.map(n=>n/(sum||1));};
 const groups=(colors:string[])=>{const out=new Map<number,string[]>();for(const color of new Set(colors)){const family=pigmentFamily(color);out.set(family,[...out.get(family)??[],color]);}return out;};
 const a=groups(front),b=groups(back),result=new Map<string,string>();
 for(const [family,left]of a){const right=b.get(family);if(left.length!==1||right?.length!==1)continue;
  const p=rgb(left[0]),q=rgb(right[0]),pc=chroma(p),qc=chroma(q),brightness=Math.abs(Math.max(...p)-Math.max(...q))/255;
  // Normalized RGB distinguishes different paint from brightness changes.
  // Very dark samples have unstable chromaticity; require near-equal RGB.
  const matches=family===6?Math.hypot(...p.map((n,i)=>n-q[i]))<=8:brightness<=.15&&Math.hypot(...pc.map((n,i)=>n-qc[i]))<=.025;
  if(!matches)continue;
  const difference=Math.max(...p)-Math.max(...q),color=difference>0?left[0]:difference<0?right[0]:[left[0],right[0]].sort()[0];result.set(left[0],color);result.set(right[0],color);
 }
 return result;
}

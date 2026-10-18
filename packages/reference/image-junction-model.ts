import {gaussianCorrelation,gaussianCoverage} from './image-gaussian-coverage';
type P={xMm:number;yMm:number};
type Ray={points:P[];colors:string[]};
function solve(matrix:number[][],rhs:number[]){
 const a=matrix.map((r,i)=>[...r,rhs[i]]),n=rhs.length;
 for(let i=0;i<n;i++){let pivot=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;if(Math.abs(a[pivot][i])<1e-10)return;[a[i],a[pivot]]=[a[pivot],a[i]];const d=a[i][i];for(let k=i;k<=n;k++)a[i][k]/=d;for(let j=0;j<n;j++)if(j!==i){const v=a[j][i];for(let k=i;k<=n;k++)a[j][k]-=v*a[i][k];}}
 return a.map(r=>r[n]);
}
/** Joint RGB observation for a three-material meeting point. Three blurred
 * sectors share one point and blur radius; their colors and local lighting
 * are fitted together. This avoids treating a mixed plateau as a fourth
 * material. A withheld pixel set must independently agree with the model. */
export function measureMaterialJunction(origin:P,rays:Ray[],width:number,height:number,rgba:Uint8Array,radius=7){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||rgba.length!==width*height*4)return;
 const finite=(p:P)=>Number.isFinite(p.xMm)&&Number.isFinite(p.yMm)&&p.xMm>=0&&p.yMm>=0&&p.xMm<=width&&p.yMm<=height;
 if(!finite(origin)||rays.some(r=>r.points.length>65536||r.points.some(p=>!finite(p))||r.colors.some(c=>!/^#[0-9a-f]{6}$/i.test(c))))return;
 if(!Number.isInteger(radius)||radius<4||radius>7)return;
 if(rays.length!==3||rays.some(r=>r.colors.length!==2||r.points.length<7))return;
 const ordered=rays.map((r,index)=>{const p=r.points[Math.min(10,r.points.length-1)];return{...r,index,angle:Math.atan2(p.yMm-origin.yMm,p.xMm-origin.xMm)};}).sort((a,b)=>a.angle-b.angle);
 const sectors=ordered.map((r,i)=>r.colors.filter(c=>ordered[(i+1)%3].colors.includes(c)));
 if(sectors.some(s=>s.length!==1)||new Set(sectors.flat()).size!==3)return;
 const colors=sectors.map(s=>[1,3,5].map(k=>parseInt(s[0].slice(k,k+2),16)));
 if(colors.flat().some(v=>!Number.isFinite(v)))return;
 const samples:{x:number;y:number;rgb:number[];training:boolean}[]=[];
 for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++){
  const px=Math.floor(origin.xMm)+x,py=Math.floor(origin.yMm)+y;if(px<0||py<0||px>=width||py>=height||rgba[4*(py*width+px)+3]!==255)return;
  samples.push({x:px+.5-origin.xMm,y:py+.5-origin.yMm,rgb:Array.from(rgba.subarray(4*(py*width+px),4*(py*width+px)+3)),training:(x+y)%2===0});
 }
 const observedContrast=Math.hypot(...[0,1,2].map(k=>Math.max(...samples.map(s=>s.rgb[k]))-Math.min(...samples.map(s=>s.rgb[k]))));if(observedContrast<40)return;
 const evaluate=(p:number[])=>{
  if(Math.hypot(p[0],p[1])>4||p.slice(2,5).some(a=>Math.abs(a)>.45)||p[5]<.6||p[5]>4)return;
  const angles=ordered.map((r,i)=>r.angle+p[i+2]),gaps=angles.map((a,i)=>(i===2?angles[0]+Math.PI*2:angles[i+1])-a);if(gaps.some(a=>a<.12||a>Math.PI*2-.12))return;
  const wedges=angles.map((a,i)=>{const b=a+gaps[i],reflex=gaps[i]>Math.PI,n1=[-Math.sin(a),Math.cos(a)],n2=[Math.sin(b),-Math.cos(b)];if(reflex){n1[0]*=-1;n1[1]*=-1;n2[0]*=-1;n2[1]*=-1;}return{n1,n2,reflex,terms:gaussianCorrelation(Math.max(-1,Math.min(1,n1[0]*n2[0]+n1[1]*n2[1])))};});
  const rows=samples.map(s=>{const x=(s.x-p[0])/p[5],y=(s.y-p[1])/p[5],coverage=wedges.slice(0,2).map(w=>{const c=gaussianCoverage(x*w.n1[0]+y*w.n1[1],x*w.n2[0]+y*w.n2[1],w.terms);return w.reflex?1-c:c;});return[1,...coverage,s.x/radius,s.y/radius];});
  const matrix=Array.from({length:5},()=>Array(5).fill(0)),rhs=Array.from({length:3},()=>Array(5).fill(0));
  for(let i=0;i<samples.length;i++)if(samples[i].training)for(let a=0;a<5;a++){for(let b=0;b<5;b++)matrix[a][b]+=rows[i][a]*rows[i][b];for(let c=0;c<3;c++)rhs[c][a]+=rows[i][a]*samples[i].rgb[c];}
  const coeff=rhs.map(r=>solve(matrix,r));if(coeff.some(c=>!c))return;
  const measuredColors=[0,1,2].map(i=>coeff.map(c=>c![0]+(i<2?c![i+1]:0)));
  if(measuredColors.flat().some(v=>v< -15||v>270)||measuredColors.some((v,i)=>colors.some((color,j)=>j!==i&&Math.hypot(...color.map((c,k)=>c-v[k]))<Math.hypot(...colors[i].map((c,k)=>c-v[k])))))return;
  const residuals=samples.flatMap((s,i)=>s.rgb.map((v,c)=>(v-rows[i].reduce((sum,x,k)=>sum+x*coeff[c]![k],0))/observedContrast));
  let train=0,held=0,nt=0,nh=0;for(let i=0;i<samples.length;i++){const e=residuals.slice(i*3,i*3+3).reduce((s,v)=>s+v*v,0);if(samples[i].training){train+=e;nt++;}else{held+=e;nh++;}}
  return{error:Math.sqrt(train/nt),held:Math.sqrt(held/nh),residuals:residuals.filter((_,i)=>samples[Math.floor(i/3)].training),angles};
 };
 let best:{params:number[];score:NonNullable<ReturnType<typeof evaluate>>}|undefined;
 for(const sigma of[1,2,3]){
  let params=[0,0,0,0,0,sigma],score=evaluate(params);if(!score)continue;let damping=.01;
  for(let iteration=0;iteration<32;iteration++){
   const residuals=score.residuals,columns=params.map((_,k)=>{const h=k<2?.001:k<5?.0001:.001,a=[...params],b=[...params];a[k]+=h;b[k]-=h;const up=evaluate(a)?.residuals,down=evaluate(b)?.residuals;return residuals.map((v,i)=>up&&down?(up[i]-down[i])/(2*h):up?(up[i]-v)/h:down?(v-down[i])/h:0);});
   const h=columns.map(a=>columns.map(b=>a.reduce((s,v,i)=>s+v*b[i],0))),g=columns.map(a=>-a.reduce((s,v,i)=>s+v*residuals[i],0));
   const delta=solve(h.map((r,i)=>r.map((v,j)=>v+(i===j?damping*Math.max(h[i][i],1e-8):0))),g);if(!delta)break;
   const next=params.map((v,i)=>v+delta[i]),candidate=evaluate(next);if(candidate&&candidate.error<score.error){const change=score.error-candidate.error;params=next;score=candidate;damping=Math.max(1e-8,damping*.3);if(change<1e-7)break;}else{damping*=10;if(damping>1e7)break;}
  }
  if(!best||score.error<best.score.error)best={params,score};
 }
 if(!best||!Number.isFinite(best.score.error)||!Number.isFinite(best.score.held)||best.score.angles.some(a=>!Number.isFinite(a))||best.score.error>.015||best.score.held>.02)return;
 const tip={xMm:origin.xMm+best.params[0],yMm:origin.yMm+best.params[1]};
 return{tip,error:Math.max(best.score.error,best.score.held),rays:ordered.map((r,i)=>({index:r.index,angle:best!.score.angles[i],negativeColor:sectors[(i+2)%3][0],positiveColor:sectors[i][0]}))};
}

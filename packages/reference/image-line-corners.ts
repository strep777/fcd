import {curvedSourceCusps} from './image-curved-cusps';
import {sourceEvidenceCache} from './image-tip-evidence-cache';
import {gaussianCorrelation,gaussianCoverage,removedCapCoverage} from './image-gaussian-coverage';
import type {Point} from '../schema/index';
type Score={error:number;contrast:number;fitError?:number;residuals?:number[]};
type Candidate=Score&{flankExtrapolationError?:number;alternatives:{kind:number;error:number;fitError?:number;params:number[]}[];radius:number;i:number;point:P;tip:P;left:MeasuredLine;right:MeasuredLine;n1:P;n2:P;sigma:number;initialError:number;params:number[];error:number;contrast:number;accepted:boolean};
type MeasuredLine=ReturnType<typeof line>&{points:P[];sigma:number};
type Corner={i:number;tip:P;sigma:number;error:number;n1?:P;n2?:P;border?:'left'|'right'|'top'|'bottom'};
type Rejection={i:number;p:P;gate:string;l?:number;r?:number;det?:number;determinant?:number;q?:P;sl?:number;sr?:number};
type P={xMm:number;yMm:number;id?:string};
const dist=(a:P,b:P)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
const sub=(a:P,b:P):P=>({xMm:a.xMm-b.xMm,yMm:a.yMm-b.yMm});
const dot=(a:P,b:P)=>a.xMm*b.xMm+a.yMm*b.yMm;
function line(ps:P[]){
 const c={xMm:ps.reduce((s,p)=>s+p.xMm,0)/ps.length,yMm:ps.reduce((s,p)=>s+p.yMm,0)/ps.length};let xx=0,xy=0,yy=0;
 for(const p of ps){const q=sub(p,c);xx+=q.xMm*q.xMm;xy+=q.xMm*q.yMm;yy+=q.yMm*q.yMm;}
 const a=.5*Math.atan2(2*xy,xx-yy),n={xMm:-Math.sin(a),yMm:Math.cos(a)},errors=ps.map(p=>dot(n,sub(p,c)));
 return{c,n,error:Math.sqrt(errors.reduce((s,v)=>s+v*v,0)/ps.length),max:Math.max(...errors)-Math.min(...errors)};
}
function solve(m:number[][],v:number[]){const a=m.map((r,i)=>[...r,v[i]]);for(let i=0;i<v.length;i++){let k=i;for(let j=i+1;j<v.length;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;if(Math.abs(a[k][i])<1e-10)return;[a[i],a[k]]=[a[k],a[i]];const d=a[i][i];for(let j=i;j<=v.length;j++)a[i][j]/=d;for(let k=0;k<v.length;k++)if(k!==i){const d=a[k][i];for(let j=i;j<=v.length;j++)a[k][j]-=d*a[i][j];}}return a.map(r=>r.at(-1)!);}
/** Recover a sharp intersection from the original opaque RGB samples. The
 * raster boundary only proposes the two flanks. A blurred two-colour wedge,
 * including a planar illumination term, must explain every source sample in
 * the fixed neighbourhood. No curve regularisation or image smoothing occurs.
 * Unsupported blur, rounded/flat ends, missing alpha and extra materials keep
 * the existing source path. All sizes and work limits are in native pixels. */
const cachedMeasurement=sourceEvidenceCache<ReturnType<typeof measureTips>>();
/** Select a noisy corner by its two observed sides. Cap RGB residuals are
 * measured in different patches and cannot rank geometric extrapolation.
 * Propagate each line's measured normal residual through its support span
 * and the two-line intersection. This selects a source observation; it does
 * not average tips or move an already fitted path. */
export function compareSourceTips(a:Candidate,b:Candidate){
 const cleanA=(a.fitError??Infinity)<.015,cleanB=(b.fitError??Infinity)<.015;
 if(cleanA!==cleanB)return cleanA?-1:1;
 if(!cleanA){const difference=(a.flankExtrapolationError??Infinity)-(b.flankExtrapolationError??Infinity);if(Number.isFinite(difference)&&difference!==0)return difference;}
 return a.error-b.error;
}
export function inferTips(vertices:P[],closed:boolean,width:number,height:number,rgba:Uint8Array){
 // Validate before allocating a geometry key. Node identifiers belong to the
 // caller; the pixel measurement and cached result contain coordinates only.
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 if(vertices.length<8||vertices.length>512||vertices.some(p=>!Number.isFinite(p.xMm)||!Number.isFinite(p.yMm)||p.xMm<0||p.xMm>width||p.yMm<0||p.yMm>height))return{source:[] as P[],candidates:[] as Candidate[],rejects:[] as Rejection[]};
 const points=vertices.map(p=>({xMm:p.xMm,yMm:p.yMm}));
 const key=JSON.stringify([width,height,closed,points.map(p=>[Object.is(p.xMm,-0)?'-0':p.xMm,Object.is(p.yMm,-0)?'-0':p.yMm])]);
 const measured=cachedMeasurement(rgba,key,observe=>measureTips(points,closed,width,height,rgba,observe));
 if(!closed&&measured.source.length)measured.source[measured.source.length-1]={...vertices.at(-1)!};
 return measured;
}
function measureTips(vertices:P[],closed:boolean,width:number,height:number,rgba:Uint8Array,observe:(pixelIndex:number)=>void){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 const empty=()=>({source:[] as P[],candidates:[] as Candidate[],rejects:[] as Rejection[]});if(vertices.length<8||vertices.length>512||vertices.some(p=>!Number.isFinite(p.xMm)||!Number.isFinite(p.yMm)||p.xMm<0||p.xMm>width||p.yMm<0||p.yMm>height))return empty();
 const source:P[]=[];for(let i=0;i<vertices.length-(closed?0:1);i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],n=Math.max(1,Math.ceil(dist(a,b)-1e-8));if(source.length+n>1536)return empty();for(let j=0;j<n;j++)source.push({xMm:a.xMm+(b.xMm-a.xMm)*j/n,yMm:a.yMm+(b.yMm-a.yMm)*j/n});}if(!closed)source.push(vertices.at(-1)!);
 // Each flank uses samples 8..22 pixels from the proposed corner. A shorter
 // loop reuses its opposite side as evidence and cannot support this model.
 if(source.length<48)return{source,candidates:[] as Candidate[],rejects:[] as Rejection[]};
 const rgb=(p:P)=>{const x=p.xMm-.5,y=p.yMm-.5,ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;if(ix<0||iy<0||ix>=width-1||iy>=height-1)return;const at=(dx:number,dy:number,c:number)=>{const index=(iy+dy)*width+ix+dx;observe(index);return rgba[4*index+c];};if([at(0,0,3),at(0,1,3),at(1,0,3),at(1,1,3)].some(v=>v!==255))return;return [0,1,2].map(c=>at(0,0,c)*(1-tx)*(1-ty)+at(1,0,c)*tx*(1-ty)+at(0,1,c)*(1-tx)*ty+at(1,1,c)*tx*ty);};
 const at=(i:number)=>source[closed?((i%source.length)+source.length)%source.length:Math.max(0,Math.min(source.length-1,i))],all:Candidate[]=[],rejects:Rejection[]=[];
 const measure=(ps:P[],l:ReturnType<typeof line>)=>{
  const out:P[]=[],sigmas:number[]=[];
  for(const p of ps){const samples=Array.from({length:65},(_,i)=>rgb({xMm:p.xMm+l.n.xMm*(i/4-8),yMm:p.yMm+l.n.yMm*(i/4-8)}));if(samples.some(s=>!s))continue;
   const a=[0,1,2].map(c=>(samples[0]![c]+samples[1]![c]+samples[2]![c])/3),b=[0,1,2].map(c=>(samples[62]![c]+samples[63]![c]+samples[64]![c])/3),d=b.map((v,c)=>v-a[c]),norm=dot3(d,d);if(norm<20**2)continue;
   const values=samples.map(s=>dot3(s!.map((v,c)=>v-a[c]),d)/norm),cross:number[]=[];for(let i=16;i<48;i++)if(values[i]<=.5&&values[i+1]>.5)cross.push(i/4-8+.25*(.5-values[i])/(values[i+1]-values[i]));
   if(cross.length!==1||Math.abs(cross[0])>3)continue;const t=cross[0],station=Math.round((t+8)*4),slope=(values[Math.min(64,station+2)]-values[Math.max(0,station-2)]);
   if(slope<=0)continue;sigmas.push(.39894/slope);out.push({xMm:p.xMm+l.n.xMm*t,yMm:p.yMm+l.n.yMm*t});
  }
  if(out.length<8)return;const fit=line(out);if(fit.error>.3||fit.max>1)return;sigmas.sort((a,b)=>a-b);return{...fit,points:out,sigma:sigmas[Math.floor(sigmas.length/2)]};
 };
 const flankNoise=(flank:MeasuredLine)=>{
  const points=flank.points.map(p=>({x:-(p.xMm-flank.c.xMm)*flank.n.yMm+(p.yMm-flank.c.yMm)*flank.n.xMm}));
  const min=Math.min(...points.map(p=>p.x)),max=Math.max(...points.map(p=>p.x)),samples:{u:number;v:number;rgb:number[]}[]=[];
  // Match the corner model's native pixel observations: interpolation would
  // suppress flank noise and make the two residuals incomparable.
  const seen=new Set<number>();
  for(let u=min;u<=max;u+=2)for(let v=-5;v<=5;v++){
   const x=Math.floor(flank.c.xMm-flank.n.yMm*u+flank.n.xMm*v),y=Math.floor(flank.c.yMm+flank.n.xMm*u+flank.n.yMm*v);
   if(x<0||y<0||x>=width||y>=height)return undefined;
   const index=y*width+x;if(seen.has(index))continue;seen.add(index);observe(index);if(rgba[4*index+3]!==255)return undefined;
   const dx=x+.5-flank.c.xMm,dy=y+.5-flank.c.yMm;
   samples.push({u:-dx*flank.n.yMm+dy*flank.n.xMm,v:dx*flank.n.xMm+dy*flank.n.yMm,rgb:[rgba[4*index],rgba[4*index+1],rgba[4*index+2]]});
  }
  if(samples.length<44)return undefined;
  const range=Math.hypot(...[0,1,2].map(c=>Math.max(...samples.map(p=>p.rgb[c]))-Math.min(...samples.map(p=>p.rgb[c]))));if(range<30)return undefined;
  // The observation and parameter grid are unchanged. Reuse the terms
  // independent of blur/offset and preserve each original summation order.
  const along=samples.map(p=>p.u/10),count=samples.length;
  let sumAlong=0,sumAlong2=0;const rgbSum=[0,0,0],rgbAlong=[0,0,0];
  for(let i=0;i<count;i++){const u=along[i];sumAlong+=u;sumAlong2+=u*u;for(let c=0;c<3;c++){rgbSum[c]+=samples[i].rgb[c];rgbAlong[c]+=u*samples[i].rgb[c];}}
  const coverage=new Float64Array(count);
  let best={error:Infinity,contrast:0,sigma:0,offset:0,angle:0};
  for(const sigma of [.6,.9,1.2,1.6,2,2.5,3.2,4])for(let shift=-1.5;shift<=1.5;shift+=.3)for(const angle of [-.1,0,.1]){
   const cos=Math.cos(angle),sin=Math.sin(angle);let sum=0,sum2=0,sumAlongCoverage=0;const rgbCoverage=[0,0,0];
   for(let i=0;i<count;i++){
    const p=samples[i],value=cdf((p.v*cos+p.u*sin+shift)/sigma);coverage[i]=value;
    sum+=value;sum2+=value*value;sumAlongCoverage+=value*along[i];
    for(let c=0;c<3;c++)rgbCoverage[c]+=value*p.rgb[c];
   }
   const matrix=[[count,sum,sumAlong],[sum,sum2,sumAlongCoverage],[sumAlong,sumAlongCoverage,sumAlong2]],coeff=[0,1,2].map(c=>solve(matrix,[rgbSum[c],rgbCoverage[c],rgbAlong[c]]));if(coeff.some(v=>!v))continue;
   const contrast=Math.hypot(...coeff.map(v=>v![1]));if(contrast<30||contrast>450||coeff.some(v=>v![0]<-15||v![0]>270||v![0]+v![1]<-15||v![0]+v![1]>270))continue;
   let residual=0;
   for(let i=0;i<count;i++){let colorResidual=0;for(let c=0;c<3;c++){const v=coeff[c]!;colorResidual+=(samples[i].rgb[c]-((0+v[0])+coverage[i]*v[1]+along[i]*v[2]))**2;}residual+=colorResidual;}
   const error=Math.sqrt(residual/count)/contrast;
   if(error<best.error)best={error,contrast,sigma,offset:shift,angle};
  }return best;
 };
 for(let i=closed?0:26;i<source.length-(closed?0:26);i+=2){
  const left=Array.from({length:15},(_,j)=>at(i-j-8)),right=Array.from({length:15},(_,j)=>at(i+j+8)),l=line(left),r=line(right);
  if(l.max>1.5||r.max>1.5){rejects.push({i,p:at(i),gate:'raw-line',l:l.max,r:r.max});continue;}const det=l.n.xMm*r.n.yMm-l.n.yMm*r.n.xMm;if(Math.abs(det)<.2){rejects.push({i,p:at(i),gate:'parallel',det});continue;}
  let measuredLeft=measure(left,l),measuredRight=measure(right,r);if(measuredLeft&&Math.abs(dot(measuredLeft.n,l.n))<.995)measuredLeft=undefined;if(measuredRight&&Math.abs(dot(measuredRight.n,r.n))<.995)measuredRight=undefined;
  let ml=measuredLeft??{...l,points:left,sigma:measuredRight?.sigma??2},mr=measuredRight??{...r,points:right,sigma:measuredLeft?.sigma??2};
  const determinant=ml.n.xMm*mr.n.yMm-ml.n.yMm*mr.n.xMm;if(Math.abs(determinant)<.2){rejects.push({i,p:at(i),gate:'measured-parallel',determinant});continue;}
  const a=dot(ml.n,ml.c),b=dot(mr.n,mr.c);let q={xMm:(a*mr.n.yMm-ml.n.yMm*b)/determinant,yMm:(ml.n.xMm*b-a*mr.n.xMm)/determinant};
  if(dist(q,at(i))>18||q.xMm<1||q.yMm<1||q.xMm>width-1||q.yMm>height-1){rejects.push({i,p:at(i),gate:'range',q});continue;}
  const u=sub(ml.c,q),v=sub(mr.c,q),ul=Math.hypot(u.xMm,u.yMm),vl=Math.hypot(v.xMm,v.yMm);if(ul<4||vl<4)continue;const cos=dot(u,v)/(ul*vl);if(!Number.isFinite(cos)||cos<-.6||cos>.98)continue;
  const sigma=(ml.sigma+mr.sigma)/2;if(sigma<.6||sigma>4.5||Math.abs(ml.sigma-mr.sigma)>Math.max(.5,sigma*.3)){rejects.push({i,p:at(i),gate:'sigma',sl:ml.sigma,sr:mr.sigma});continue;}
  let n1={xMm:ml.n.xMm*Math.sign(dot(ml.n,v)),yMm:ml.n.yMm*Math.sign(dot(ml.n,v))},n2={xMm:mr.n.xMm*Math.sign(dot(mr.n,u)),yMm:mr.n.yMm*Math.sign(dot(mr.n,u))};
  const capRadius=Math.ceil(Math.max(10,sigma*3)),centre=at(i),samples:{p:P;rgb:number[]}[]=[];
  for(let dy=-capRadius;dy<=capRadius;dy+=2)for(let dx=-capRadius;dx<=capRadius;dx+=2){const p={xMm:Math.floor(centre.xMm)+dx+.5,yMm:Math.floor(centre.yMm)+dy+.5},color=rgb(p);if(color)samples.push({p,rgb:color});}
  if(samples.length!==(capRadius+1)**2)continue;
  if(all.length>=64)return empty();
  const observedContrast=Math.hypot(...[0,1,2].map(c=>Math.max(...samples.map(s=>s.rgb[c]))-Math.min(...samples.map(s=>s.rgb[c]))));
  const basis=samples.map(v=>[1,(v.p.xMm-centre.xMm)/capRadius,(v.p.yMm-centre.yMm)/capRadius]);
  const fixedMatrix=Array.from({length:3},(_,a)=>Array.from({length:3},(_,b)=>basis.reduce((s,v)=>s+v[a]*v[b],0)));
  const fixedRGB=[0,1,2].map(c=>solve(fixedMatrix,Array.from({length:3},(_,a)=>samples.reduce((s,v,i)=>s+basis[i][a]*v.rgb[c],0))));
  if(fixedRGB.some(v=>!v))continue;
  const residualRGB=samples.map((v,i)=>v.rgb.map((value,c)=>value-dot3(basis[i],fixedRGB[c]!)));
  const normal=(n:P,a:number)=>({xMm:n.xMm*Math.cos(a)-n.yMm*Math.sin(a),yMm:n.xMm*Math.sin(a)+n.yMm*Math.cos(a)});
  const evaluate=(params:number[],kind=0):Score=>{const p={xMm:q.xMm+params[0],yMm:q.yMm+params[1]},a=normal(n1,params[2]),b=normal(n2,params[3]),sig=sigma+params[4],rho=dot(a,b),den=Math.sqrt(1-rho*rho);
   if(sig<.5||den<.25)return{error:Infinity,contrast:0};
   if(kind&&params[5]<0)return{error:Infinity,contrast:0};
   const correlation=gaussianCorrelation(rho),length=Math.hypot(a.xMm+b.xMm,a.yMm+b.yMm),axis={xMm:(a.xMm+b.xMm)/length,yMm:(a.yMm+b.yMm)/length},slope=Math.sqrt((1+rho)/(1-rho));
   const coverage=samples.map(v=>{const d=sub(v.p,p),u=dot(d,a)/sig,w=dot(d,b)/sig;let value=gaussianCoverage(u,w,correlation);
    if(kind)value=Math.max(0,Math.min(1,value-removedCapCoverage(dot(d,axis),-d.xMm*axis.yMm+d.yMm*axis.xMm,slope,sig,params[5],kind===2)));return value;});
   const projected=solve(fixedMatrix,Array.from({length:3},(_,a)=>coverage.reduce((s,v,i)=>s+basis[i][a]*v,0)));if(!projected)return{error:Infinity,contrast:0};
   const residualCoverage=coverage.map((v,i)=>v-dot3(basis[i],projected)),variance=residualCoverage.reduce((s,v)=>s+v*v,0);
   if(variance<1e-10)return{error:Infinity,contrast:0};
   const slopes=[0,1,2].map(c=>residualCoverage.reduce((s,v,i)=>s+v*residualRGB[i][c],0)/variance);
   const coeff=slopes.map((v,c)=>[fixedRGB[c]![0]-v*projected[0],v,fixedRGB[c]![1]-v*projected[1],fixedRGB[c]![2]-v*projected[2]]);
   const contrast=Math.hypot(...coeff.map(v=>v![1]));if(contrast<30||contrast>450||coeff.some(v=>v![0]<-15||v![0]>270||v![0]+v![1]<-15||v![0]+v![1]>270)||Math.hypot(...coeff.flatMap(v=>v!.slice(2)))>contrast*.5)return{error:Infinity,contrast};
   const residuals=residualRGB.flatMap((v,i)=>v.map((value,c)=>(value-slopes[c]*residualCoverage[i])/observedContrast));
   const error=Math.sqrt(residuals.reduce((s,v)=>s+v*v,0)/samples.length),fitError=error*observedContrast/contrast;
   return{error,fitError,contrast,residuals};
  };
  let params=[0,0,0,0,0],score=evaluate(params);const initialError=score.error;
  if(score.error<.2)for(const scale of[1,.4,.15,.05,.4,.15,.05])for(let pass=0;pass<8;pass++){let improved=false;for(let k=0;k<5;k++)for(const sign of[-1,1]){const next=[...params];next[k]+=sign*scale*(k<2?1:k<4?.025:.25);if(Math.abs(next[k])>(k<2?10:k<4?.4:1.5))continue;const fit=evaluate(next);if(fit.error+1e-9<score.error){params=next;score=fit;improved=true;}}if(!improved)break;}

  // Variable-projection LM: colour/illumination coefficients remain a linear
  // least-squares solve, while location, flank angles and blur move together.
  // The residual scale is fixed by source samples, never by fitted contrast.
  if(score.residuals){let damping=.01;
   for(let iteration=0;iteration<60;iteration++){
    const base=score.residuals!;const columns:number[][]=[];
    for(let k=0;k<5;k++){
     const step=k<2?.001:k<4?.0001:.001,up=[...params],down=[...params];up[k]+=step;down[k]-=step;
     const a=evaluate(up).residuals,b=evaluate(down).residuals;
     columns.push(base.map((v,i)=>a&&b?(a[i]-b[i])/(2*step):a?(a[i]-v)/step:b?(v-b[i])/step:0));
    }
    const h=columns.map(a=>columns.map(b=>a.reduce((s,v,i)=>s+v*b[i],0))),gradient=columns.map(a=>a.reduce((s,v,i)=>s+v*base[i],0));
    const step=solve(h.map((row,i)=>row.map((v,j)=>v+(i===j?damping*Math.max(h[i][i],1e-8):0))),gradient.map(v=>-v));if(!step)break;
    const next=params.map((v,k)=>v+step[k]),inRange=next.every((v,k)=>Math.abs(v)<=(k<2?10:k<4?.4:1.5));
    const candidate=inRange?evaluate(next):undefined;
    if(candidate?.residuals&&candidate.error+1e-10<score.error){const improvement=score.error-candidate.error;params=next;score=candidate;damping=Math.max(1e-8,damping*.3);if(improvement<1e-8)break;}
    else{damping*=10;if(damping>1e8)break;}
   }
  }

  let flankIntersection=false;
  // A noisy cap cannot rotate two measured straight sides to explain JPEG
  // texture. Reobserve both sides away from the fitted cap, then infer their
  // intersection. The cap is retained only as an independent RGB model test.
  if((score.fitError??Infinity)>=.015&&(score.fitError??Infinity)<.09){
   const freeTip={xMm:q.xMm+params[0],yMm:q.yMm+params[1]},normals=[normal(n1,params[2]),normal(n2,params[3])],flanks=[ml,mr];
   const observed=flanks.map((flank,k)=>{
    const n=normals[k],t={xMm:-n.yMm,yMm:n.xMm},sign=Math.sign(dot(t,sub(flank.c,freeTip)));
    const ps=Array.from({length:15},(_,i)=>({xMm:freeTip.xMm+t.xMm*sign*(12+i),yMm:freeTip.yMm+t.yMm*sign*(12+i)}));
    if(ps.some(p=>Math.min(...source.map(q=>dist(p,q)))>2))return;
    const measured=measure(ps,{c:flank.c,n,error:0,max:0});
    return measured&&Math.abs(dot(measured.n,n))>=.995?measured:undefined;
   });
   measuredLeft=observed[0]??measuredLeft;measuredRight=observed[1]??measuredRight;
   if(measuredLeft&&measuredRight){
    ml=measuredLeft;mr=measuredRight;const det=ml.n.xMm*mr.n.yMm-ml.n.yMm*mr.n.xMm;
    if(Math.abs(det)>=.2){const a=dot(ml.n,ml.c),b=dot(mr.n,mr.c),intersection={xMm:(a*mr.n.yMm-ml.n.yMm*b)/det,yMm:(ml.n.xMm*b-a*mr.n.xMm)/det};
     if(dist(intersection,freeTip)<=4&&intersection.xMm>=1&&intersection.yMm>=1&&intersection.xMm<=width-1&&intersection.yMm<=height-1){
      q=intersection;const left=sub(ml.c,q),right=sub(mr.c,q);n1={xMm:ml.n.xMm*Math.sign(dot(ml.n,right)),yMm:ml.n.yMm*Math.sign(dot(ml.n,right))};n2={xMm:mr.n.xMm*Math.sign(dot(mr.n,left)),yMm:mr.n.yMm*Math.sign(dot(mr.n,left))};
      flankIntersection=true;params=[0,0,0,0,0];score=evaluate(params);
      for(const step of [.5,.2,.05,.01])for(let pass=0;pass<8;pass++){let changed=false;for(const sign of [-1,1]){const trial=[...params];trial[4]+=step*sign;if(Math.abs(trial[4])>1.5)continue;const fit=evaluate(trial);if(fit.error+1e-9<score.error){params=trial;score=fit;changed=true;}}if(!changed)break;}
     }
    }
   }
  }
  const fitError=score.fitError??Infinity;
  // A noisy cap is only inferable from two independently measured RGB flanks.
  // Raster staircases alone are proposals, not evidence of straight sides.
  const flankErrors=measuredLeft&&measuredRight&&fitError>=.015&&fitError<.09?[flankNoise(ml),flankNoise(mr)]:[];
  const supported=fitError<.015||(flankIntersection&&flankErrors.length===2&&flankErrors.every(v=>v&&v.error<.09&&v.sigma<4&&Math.abs(v.offset)<1.5)&&fitError<=Math.max(...flankErrors.map(v=>v!.error))*(1+2*Math.sqrt(1/(2*samples.length)+1/(2*44))));
  const alternatives=[];
  if(score.residuals&&supported){
   for(const kind of [1,2]){
    let best:Partial<Score>&Pick<Score,"error">={error:Infinity};let bestParams:number[]=[];
    for(const initial of [4]){
     let trial=[...params,initial],current=evaluate(trial,kind),damping=.01;
     if(!current.residuals)continue;
     for(let iteration=0;iteration<20;iteration++){
      const base=current.residuals!;const columns:number[][]=[];
      for(let k=0;k<6;k++){const step=k<2?.001:k<4?.0001:.001,up=[...trial],down=[...trial];up[k]+=step;down[k]-=step;
       const a=evaluate(up,kind).residuals,b=evaluate(down,kind).residuals;
       columns.push(base.map((v,i)=>a&&b?(a[i]-b[i])/(2*step):a?(a[i]-v)/step:b?(v-b[i])/step:0));}
      const h=columns.map(a=>columns.map(b=>a.reduce((s,v,i)=>s+v*b[i],0))),gradient=columns.map(a=>a.reduce((s,v,i)=>s+v*base[i],0));
      const delta=solve(h.map((row,i)=>row.map((v,j)=>v+(i===j?damping*Math.max(h[i][i],1e-8):0))),gradient.map(v=>-v));if(!delta)break;
      const next=trial.map((v,k)=>v+delta[k]),inRange=next.every((v,k)=>k===5?v>=0&&v<=12:Math.abs(v)<=(k<2?10:k<4?.4:1.5)),candidate=inRange?evaluate(next,kind):undefined;
      if(candidate?.residuals&&candidate.error+1e-10<current.error){const improvement=current.error-candidate.error;trial=next;current=candidate;damping=Math.max(1e-8,damping*.3);if(improvement<1e-8)break;}
      else{damping*=10;if(damping>1e8)break;}
     }
     if(current.error<best.error){best=current;bestParams=trial;}
    }
    alternatives.push({kind,error:best.error,fitError:best.fitError,params:bestParams});
   }
  }
  const supportVariance=(flank:MeasuredLine)=>{
   const t={xMm:-flank.n.yMm,yMm:flank.n.xMm},spread=flank.points.reduce((sum,p)=>sum+dot(sub(p,flank.c),t)**2,0),extrapolation=dot(sub(q,flank.c),t);
   return spread>0?flank.error**2*(1/flank.points.length+extrapolation**2/spread):Infinity;
  };
  const flankExtrapolationError=flankIntersection?Math.sqrt(supportVariance(ml)+supportVariance(mr))/Math.abs(ml.n.xMm*mr.n.yMm-ml.n.yMm*mr.n.xMm):undefined;
  all.push({flankExtrapolationError,radius:capRadius,alternatives,i,point:at(i),tip:{xMm:q.xMm+params[0],yMm:q.yMm+params[1]},left:ml,right:mr,n1:normal(n1,params[2]),n2:normal(n2,params[3]),sigma:sigma+params[4],initialError,params,...score,accepted:supported&&score.contrast>30&&!alternatives.some(v=>v.error<score.error*.9&&v.params[5]/(v.kind===2?2:1)>1)});
 }
 const additional=curvedSourceCusps(source,closed,width,height,rgba,observe).filter(c=>!all.some(v=>v.accepted&&dist(v.tip,c.tip)<12));return{source,candidates:[...all,...additional],rejects};
}
const dot3=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0);
function cdf(x:number){const t=1/(1+.2316419*Math.abs(x)),poly=t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));const tail=Math.exp(-x*x/2)/Math.sqrt(2*Math.PI)*poly;return x>=0?1-tail:tail;}

/** An entire polygon is eligible only when every corner is source-supported
 * and every intervening straight edge agrees with the original traced strip.
 * This narrow path allows a blurred tip to extend beyond the raster mask;
 * shared-network validation still rejects crossings and changed topology. */
export function sourceTipPolygon(vertices:P[],width:number,height:number,rgba:Uint8Array,createId:()=>string,model?:ReturnType<typeof inferTips>){
 const {source,candidates}=model??inferTips(vertices,true,width,height,rgba),selected:Corner[]=[];
 for(const c of candidates.filter(c=>c.accepted).sort(compareSourceTips))if(!selected.some(v=>dist(v.tip,c.tip)<12))selected.push({...c});
 if(!selected.length)return;
 const border=(p:P)=>p.xMm===0?'left':p.xMm===width?'right':p.yMm===0?'top':p.yMm===height?'bottom':undefined;
 for(let i=0;i<source.length;i++){const p=source[i],side=border(p);if(side&&(border(source[(i+source.length-1)%source.length])!==side||border(source[(i+1)%source.length])!==side))selected.push({i,tip:p,border:side,sigma:0,error:0});}
 // The model fitting patch may be centred several samples away from its
 // recovered corner. Exclude blur around the actual geometric corner when
 // checking its straight sides, not around the original search patch.
 for(const c of selected){if(c.border)continue;let nearest=c.i,best=Infinity;for(let j=c.i-24;j<=c.i+24;j++){const k=(j%source.length+source.length)%source.length,error=dist(c.tip,source[k]);if(error<best){best=error;nearest=k;}}c.i=nearest;}
 selected.sort((a,b)=>a.i-b.i);if(selected.length<3||selected.length>48)return;
 for(let i=0;i<selected.length;i++){const c=selected[i];if(!c.border)continue;const neighbour=[selected[(i+selected.length-1)%selected.length],selected[(i+1)%selected.length]].find(v=>!v.border);if(!neighbour)return;const d=sub(c.tip,neighbour.tip),normal=[neighbour.n1!,neighbour.n2!].sort((a,b)=>Math.abs(dot(a,d))-Math.abs(dot(b,d)))[0],vertical=c.border==='left'||c.border==='right',tip=vertical?{xMm:c.tip.xMm,yMm:neighbour.tip.yMm-normal.xMm*(c.tip.xMm-neighbour.tip.xMm)/normal.yMm}:{yMm:c.tip.yMm,xMm:neighbour.tip.xMm-normal.yMm*(c.tip.yMm-neighbour.tip.yMm)/normal.xMm};if(!Number.isFinite(tip.xMm)||!Number.isFinite(tip.yMm)||dist(tip,c.tip)>Math.max(4,neighbour.sigma*3)||tip.xMm<0||tip.xMm>width||tip.yMm<0||tip.yMm>height)return;c.tip=tip;}
 const reasons:({crop:string}|{error:number;points:number})[]=[];
 for(let i=0;i<selected.length;i++){
  const a=selected[i],b=selected[(i+1)%selected.length],n=(b.i-a.i+source.length)%source.length,chord=dist(a.tip,b.tip);if(a.border&&a.border===b.border){reasons.push({crop:a.border});continue;}if(chord<12||n<20)return;
  const direction={xMm:(b.tip.xMm-a.tip.xMm)/chord,yMm:(b.tip.yMm-a.tip.yMm)/chord};
  if(!a.border&&Math.min(Math.abs(dot(a.n1!,direction)),Math.abs(dot(a.n2!,direction)))>.08||!b.border&&Math.min(Math.abs(dot(b.n1!,direction)),Math.abs(dot(b.n2!,direction)))>.08)return;
  const normal={xMm:-direction.yMm,yMm:direction.xMm},excludeA=a.border?2:Math.max(8,Math.ceil(a.sigma*3)),excludeB=b.border?2:Math.max(8,Math.ceil(b.sigma*3)),core=Array.from({length:Math.max(0,n-excludeA-excludeB)},(_,k)=>source[(a.i+excludeA+k)%source.length]);
  if(core.length<6)return;const error=Math.max(...core.map(p=>Math.abs(dot(sub(p,a.tip),normal))));reasons.push({error,points:core.length});if(error>1.5)return;
 }
 const nodes:Point[]=selected.map(c=>({...c.tip,id:createId()}));
 const area=(ring:P[])=>ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p.xMm*q.yMm-q.xMm*p.yMm;},0);
 if(Math.sign(area(nodes))!==Math.sign(area(vertices))||nodes.some(p=>!Number.isFinite(p.xMm)||!Number.isFinite(p.yMm)||p.xMm<0||p.xMm>width||p.yMm<0||p.yMm>height))return;
 return{nodes,curves:[],evidence:selected.map(c=>({tip:c.tip,error:c.error,sigma:c.sigma})),lines:reasons};
}

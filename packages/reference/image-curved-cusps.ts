type P={xMm:number;yMm:number};
const dot=(a:P,b:P)=>a.xMm*b.xMm+a.yMm*b.yMm;
const sub=(a:P,b:P):P=>({xMm:a.xMm-b.xMm,yMm:a.yMm-b.yMm});
const distance=(a:P,b:P)=>Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm);
function solve(matrix:number[][],values:number[]){const a=matrix.map((r,i)=>[...r,values[i]]),n=values.length;for(let i=0;i<n;i++){let k=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;if(Math.abs(a[k][i])<1e-10)return;[a[i],a[k]]=[a[k],a[i]];const v=a[i][i];for(let j=i;j<=n;j++)a[i][j]/=v;for(let k=0;k<n;k++)if(k!==i){const v=a[k][i];for(let j=i;j<=n;j++)a[k][j]-=v*a[i][j];}}return a.map(r=>r[n]);}

/** A narrow cusp can truncate before the nearest pixel centre. Recover its
 * incident, genuinely curved flanks only when their RGB observations explain
 * a sharp, narrow material transition over the complete native-pixel patch.
 * The quadratic is a local measurement model; no path smoothing is performed. */
export function curvedSourceCusps(source:P[],closed:boolean,width:number,height:number,rgba:Uint8Array,observe:(index:number)=>void){
 const at=(i:number)=>source[closed?(i%source.length+source.length)%source.length:Math.max(0,Math.min(source.length-1,i))];
 const rgb=(p:P)=>{const x=p.xMm-.5,y=p.yMm-.5,ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy;if(ix<0||iy<0||ix+1>=width||iy+1>=height)return;const out=[0,0,0];for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=(iy+dy)*width+ix+dx;observe(i);if(rgba[4*i+3]!==255)return;const w=(dx?u:1-u)*(dy?v:1-v);for(let c=0;c<3;c++)out[c]+=rgba[4*i+c]*w;}return out;};
 const measure=(p:P,t:P,reference:number[][])=>{
  const n={xMm:-t.yMm,yMm:t.xMm},sample=(d:number)=>rgb({xMm:p.xMm+n.xMm*d,yMm:p.yMm+n.yMm*d});
  const plates=[-3,-2.5,2.5,3].map(sample);if(plates.some(v=>!v))return;
  const a=reference[0],b=reference[1],delta=b.map((v,k)=>v-a[k]),norm=delta.reduce((s,v)=>s+v*v,0);if(norm<60**2)return;
  const value=(color:number[])=>color.reduce((s,v,k)=>s+(v-a[k])*delta[k],0)/norm;
  if(Math.abs(value(plates[1]!))>.08||Math.abs(value(plates[2]!)-1)>.08)return;
  const values=Array.from({length:25},(_,j)=>sample(-1.5+j/8));if(values.some(v=>!v))return;const scalar=values.map(v=>value(v!)),cross:number[]=[];
  for(let j=0;j<24;j++)if(scalar[j]<=.5&&scalar[j+1]>.5)cross.push(-1.5+j/8+(.5-scalar[j])/(scalar[j+1]-scalar[j])/8);
  if(cross.length!==1)return;const d=cross[0],u=sample(d-.5),v=sample(d+.5);if(!u||!v||value(v)-value(u)<.35)return;
  return{xMm:p.xMm+n.xMm*d,yMm:p.yMm+n.yMm*d};
 };
 const flank=(i:number,sign:number,span=16)=>{
  const o=at(i),last=at(i+sign*span),len=distance(o,last);if(len<8)return;const t={xMm:(last.xMm-o.xMm)/len,yMm:(last.yMm-o.yMm)/len},n={xMm:-t.yMm,yMm:t.xMm},points:P[]=[];
  const refA=at(i+sign*(span-2)),refB=at(i+sign*(span+2)),refLength=distance(refA,refB),refNormal={xMm:-(refB.yMm-refA.yMm)/refLength,yMm:(refB.xMm-refA.xMm)/refLength};
  if(refLength<1)return;
  const reference=[-4,4].map(d=>rgb({xMm:last.xMm+d*refNormal.xMm,yMm:last.yMm+d*refNormal.yMm}));if(reference.some(v=>!v))return;
  for(let k=5;k<=span;k++){const p=at(i+sign*k),a=at(i+sign*(k-2)),b=at(i+sign*(k+2)),l=distance(a,b);if(l<1)continue;const q=measure(p,{xMm:(b.xMm-a.xMm)/l,yMm:(b.yMm-a.yMm)/l},reference as number[][]);if(q)points.push(q);}
  if(points.length<9)return;const coordinates=points.map(p=>{const d=sub(p,o);return{u:dot(d,t),v:dot(d,n)};}),basis=coordinates.map(p=>[1,p.u,p.u*p.u]);
  const coeff=solve([0,1,2].map(a=>[0,1,2].map(b=>basis.reduce((s,v)=>s+v[a]*v[b],0))),[0,1,2].map(k=>basis.reduce((s,v,j)=>s+v[k]*coordinates[j].v,0)));if(!coeff||Math.abs(coeff[2])>.04)return;
  const residual=coordinates.map(p=>p.v-coeff[0]-coeff[1]*p.u-coeff[2]*p.u*p.u),error=Math.sqrt(residual.reduce((s,v)=>s+v*v,0)/residual.length);if(error>.1||Math.max(...residual)-Math.min(...residual)>.3)return;
  const value=(p:P)=>{const d=sub(p,o),u=dot(d,t),v=dot(d,n),slope=coeff[1]+2*coeff[2]*u;return{f:v-coeff[0]-coeff[1]*u-coeff[2]*u*u,g:{xMm:n.xMm-slope*t.xMm,yMm:n.yMm-slope*t.yMm}};};
  return{o,t,n,points,coeff,error,value,c:{xMm:points.reduce((s,p)=>s+p.xMm,0)/points.length,yMm:points.reduce((s,p)=>s+p.yMm,0)/points.length}};
 };
 const candidates=[];
 for(let i=closed?0:20;i<source.length-(closed?0:20);i+=2){
  const origin=at(i),leftRay=sub(at(i-10),origin),rightRay=sub(at(i+10),origin),ll=Math.hypot(leftRay.xMm,leftRay.yMm),lr=Math.hypot(rightRay.xMm,rightRay.yMm),cos=dot(leftRay,rightRay)/(ll*lr);if(ll<5||lr<5||cos<-.55||cos>.94)continue;
  const left=flank(i,-1)??flank(i,-1,24)??flank(i,-1,32),right=flank(i,1)??flank(i,1,24)??flank(i,1,32);if(!left||!right)continue;
  let tip={...origin},valid=true;for(let j=0;j<8;j++){const a=left.value(tip),b=right.value(tip),det=a.g.xMm*b.g.yMm-a.g.yMm*b.g.xMm;if(Math.abs(det)<.2){valid=false;break;}const dx=(a.f*b.g.yMm-a.g.yMm*b.f)/det,dy=(a.g.xMm*b.f-a.f*b.g.xMm)/det;tip={xMm:tip.xMm-dx,yMm:tip.yMm-dy};if(distance(tip,origin)>5){valid=false;break;}if(Math.hypot(dx,dy)<1e-7)break;}
  if(!valid||Math.abs(left.value(tip).f)+Math.abs(right.value(tip).f)>1e-5||tip.xMm<7||tip.yMm<7||tip.xMm>width-7||tip.yMm>height-7)continue;
  const signs=[Math.sign(left.value(right.c).f),Math.sign(right.value(left.c).f)],flanks=[left,right];if(signs.some(v=>!v))continue;
  const samples:{p:P;color:number[];d:number}[]=[];for(let dy=-6;dy<=6;dy++)for(let dx=-6;dx<=6;dx++){const p={xMm:Math.floor(tip.xMm)+dx+.5,yMm:Math.floor(tip.yMm)+dy+.5},color=rgb(p);if(!color){valid=false;break;}const distances=flanks.map((f,k)=>{const v=f.value(p);return signs[k]*v.f/Math.hypot(v.g.xMm,v.g.yMm);});samples.push({p,color,d:Math.min(...distances)});}if(!valid||samples.length!==169)continue;
  let best={error:Infinity,contrast:0,width:0,max:Infinity};
  for(let w=.8;w<=3.2;w+=.1){const basis=samples.map(s=>[1,Math.max(0,Math.min(1,.5+s.d/w)),(s.p.xMm-tip.xMm)/6,(s.p.yMm-tip.yMm)/6]),matrix=[0,1,2,3].map(a=>[0,1,2,3].map(b=>basis.reduce((v,row)=>v+row[a]*row[b],0))),coeff=[0,1,2].map(c=>solve(matrix,[0,1,2,3].map(k=>basis.reduce((v,row,j)=>v+row[k]*samples[j].color[c],0))));if(coeff.some(v=>!v))continue;
   const contrast=Math.hypot(...coeff.map(v=>v![1]));if(contrast<60||contrast>450||coeff.some(v=>v![0]<-10||v![0]>265||v![0]+v![1]<-10||v![0]+v![1]>265)||Math.hypot(...coeff.flatMap(v=>v!.slice(2)))>contrast*.15)continue;
   const residual=samples.map((s,i)=>Math.hypot(...s.color.map((v,c)=>v-basis[i].reduce((sum,b,k)=>sum+b*coeff[c]![k],0)))/contrast),error=Math.sqrt(residual.reduce((s,v)=>s+v*v,0)/samples.length),max=Math.max(...residual);if(error<best.error)best={error,contrast,width:w,max};
  }
  if(best.error>.018||best.max>.065)continue;
  const normals=flanks.map((f,k)=>{const {g}=f.value(tip),l=Math.hypot(g.xMm,g.yMm);return{xMm:g.xMm/l*signs[k],yMm:g.yMm/l*signs[k]};});
  candidates.push({i,point:origin,tip,radius:4,n1:normals[0],n2:normals[1],sigma:best.width/2,error:best.error,fitError:best.error,contrast:best.contrast,initialError:best.error,params:[0,0,0,0,0],alternatives:[],accepted:true,left:{c:left.c,n:normals[0],points:left.points,error:left.error,max:left.error*3,sigma:best.width/2},right:{c:right.c,n:normals[1],points:right.points,error:right.error,max:right.error*3,sigma:best.width/2}});
 }
 return candidates;
}

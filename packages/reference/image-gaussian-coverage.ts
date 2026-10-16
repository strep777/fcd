const normalCdf=(x:number)=>{const t=1/(1+.2316419*Math.abs(x)),poly=t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429)))),tail=Math.exp(-x*x/2)/Math.sqrt(2*Math.PI)*poly;return x>=0?1-tail:tail;};
const gx16=[.09501250983763744,.2816035507792589,.4580167776572274,.6178762444026438,.755404408355003,.8656312023878318,.9445750230732326,.9894009349916499];
const gw16=[.1894506104550685,.1826034150449236,.16915651939500254,.14959598881657673,.12462897125553388,.09515851168249278,.06225352393864789,.027152459411754095];
// Integrating correlation after rho=sin(theta) removes the endpoint square
// root. These terms are shared by every source pixel in one model evaluation.
export function gaussianCorrelation(rho:number){const theta=Math.asin(rho),terms:{sin:number;inverse:number;weight:number}[]=[];for(let i=0;i<8;i++)for(const sign of [-1,1]){const angle=theta/2*(1+sign*gx16[i]),cos=Math.cos(angle);terms.push({sin:Math.sin(angle),inverse:1/(2*cos*cos),weight:theta*gw16[i]/(4*Math.PI)});}return terms;}
export function gaussianCoverage(u:number,v:number,terms:ReturnType<typeof gaussianCorrelation>){let value=normalCdf(u)*normalCdf(v);const sum=u*u+v*v,product=2*u*v;for(const t of terms)value+=t.weight*Math.exp(-(sum-t.sin*product)*t.inverse);return Math.max(0,Math.min(1,value));}
const gx8=[.1834346424956498,.525532409916329,.796666477413627,.960289856497536],gw8=[.362683783378362,.313706645877887,.222381034453374,.101228536290376];
function integrate(fn:(x:number)=>number,limit:number,panels:number){let value=0;for(let i=0;i<panels;i++){const mid=limit*(i+.5)/panels,half=limit/(2*panels);for(let j=0;j<4;j++)for(const sign of [-1,1])value+=half*gw8[j]*fn(mid+sign*half*gx8[j]);}return value;}
// A cap subtracts only its small missing area from the infinite sharp wedge.
// For a quadratic end, t=cap*(1+z*z)/2 removes the square-root endpoint.
export function removedCapCoverage(along:number,across:number,k:number,sigma:number,cap:number,rounded:boolean){
 if(cap<=0)return 0;
 const panels=Math.max(1,Math.ceil(cap*Math.max(1,k)/sigma/3)),density=(t:number)=>Math.exp(-.5*((t-along)/sigma)**2)/(sigma*Math.sqrt(2*Math.PI)),acrossMass=(half:number)=>normalCdf((half-across)/sigma)-normalCdf((-half-across)/sigma);
 let removed=integrate(t=>density(t)*acrossMass(k*t),cap,panels);
 if(rounded)removed-=integrate(z=>cap*z*density(cap*(1+z*z)/2)*acrossMass(k*cap*z),1,panels);
 return removed;
}

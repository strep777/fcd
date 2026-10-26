// Resolve the sign of the triangle defined by the actual stored Float64
// coordinates. Area relative to an unrelated parent triangle is not a
// degeneracy test. The fallback uses exact dyadic integer arithmetic.
const buffer=new ArrayBuffer(8),view=new DataView(buffer);
function dyadic(value){
 if(!Number.isFinite(value))throw Error('Nonfinite triangle coordinate');
 view.setFloat64(0,value);const bits=view.getBigUint64(0),exponent=Number(bits>>52n&2047n),fraction=bits&((1n<<52n)-1n),mantissa=exponent?fraction+(1n<<52n):fraction;
 return {n:bits>>63n?-mantissa:mantissa,e:exponent?exponent-1075:-1074};
}
export function triangleOrientation([a,b,c]){
 const u=(b[0]-a[0])*(c[1]-a[1]),v=(b[1]-a[1])*(c[0]-a[0]),det=u-v,bound=4*Number.EPSILON*(Math.abs(u)+Math.abs(v));
 if(Number.isFinite(det)&&Math.max(Math.abs(u),Math.abs(v))>=2**-1022&&bound>0&&Math.abs(det)>bound)return Math.sign(det);
 const terms=[...a,...b,...c].map(dyadic),e=Math.min(...terms.filter(t=>t.n!==0n).map(t=>t.e),0),p=terms.map(t=>t.n===0n?0n:t.n<<BigInt(t.e-e));
 const exact=(p[2]-p[0])*(p[5]-p[1])-(p[3]-p[1])*(p[4]-p[0]);return exact>0n?1:exact<0n?-1:0;
}

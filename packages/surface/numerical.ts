/** Match the native validity bound: coordinate subtraction and cross products
 * must resolve direction before inverse gradients. There is no physical area floor. */
export function numericalTriangleArea(points:[number,number,number][]):number|undefined{
 if(points.length!==3||points.flat().some(n=>!Number.isFinite(n)))return;
 const [a,b,c]=points,difference=(x:number,y:number):[number,number]=>[y-x,Number.EPSILON*(Math.abs(x)+Math.abs(y)+Math.abs(y-x))],u=a.map((n,i)=>difference(n,b[i])),v=a.map((n,i)=>difference(n,c[i])),product=(x:[number,number],y:[number,number])=>Math.abs(x[0])*y[1]+Math.abs(y[0])*x[1]+x[1]*y[1]+Number.EPSILON*Math.abs(x[0]*y[0]),cross:number[]=[],errors:number[]=[];
 for(let i=0;i<3;i++){const j=(i+1)%3,k=(i+2)%3,n=u[j][0]*v[k][0]-u[k][0]*v[j][0];cross.push(n);errors.push(product(u[j],v[k])+product(u[k],v[j])+Number.EPSILON*Math.abs(n));}
 const magnitude=Math.hypot(...cross),bound=16*Math.hypot(...errors);return Number.isFinite(magnitude)&&magnitude>bound&&magnitude/2>0?magnitude/2:undefined;
}

/** Remove only border-connected pixels similar to a reliable dominant border color.
 * Enclosed white fur and contrasting pigments never share that exterior flood. */
export function borderBackground(width:number,height:number,rgba:Uint8Array):Uint8Array{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4096*4096||rgba.length!==width*height*4)throw Error('IMAGE_LIMIT');
 const border:number[]=[];for(let i=0;i<width*height;i++)if(i<width||i>=width*(height-1)||i%width===0||i%width===width-1)border.push(i);
 const bins=new Map<number,number[]>();for(const i of border)if(rgba[i*4+3]>=128){const key=(rgba[i*4]>>4)*256+(rgba[i*4+1]>>4)*16+(rgba[i*4+2]>>4);const list=bins.get(key)??[];list.push(i);bins.set(key,list);}
 const dominant=[...bins.values()].sort((a,b)=>b.length-a.length)[0]??[],reliable=dominant.length>border.filter(i=>rgba[i*4+3]>=128).length*.4;
 const color=[0,1,2].map(c=>dominant.reduce((sum,i)=>sum+rgba[i*4+c],0)/Math.max(1,dominant.length));
 const match=(i:number)=>rgba[i*4+3]<128||reliable&&Math.hypot(rgba[i*4]-color[0],rgba[i*4+1]-color[1],rgba[i*4+2]-color[2])<=48;
 const result=new Uint8Array(width*height),queue:number[]=[];for(const i of border)if(match(i)){result[i]=1;queue.push(i);}
 for(let p=0;p<queue.length;p++){const i=queue[p],x=i%width,y=Math.floor(i/width);for(const n of [x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1])if(n>=0&&!result[n]&&match(n)){result[n]=1;queue.push(n);}}
 return result;
}

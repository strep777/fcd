import type {AssemblyTriangle} from '../../../../packages/surface/cut-assembly';
type Overlay={pieceId:string;color:string;rings:number[][][];depthPoints?:number[][]};
type Item={pieceId:string;color:string;rings:number[][][];layer:number;offset:number[];depthPoints?:number[][]};
export type AssemblyCamera={yaw:number;pitch:number;zoom:number;explode:number};
/** Upload the actual binding triangles once. Camera motion never remeshes,
 * resamples, or sorts geometry on the CPU when a depth buffer is available. */
export function assemblyRenderer(canvas:HTMLCanvasElement,triangles:AssemblyTriangle[],overlays:Overlay[]){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],centres=new Map<string,{sum:number[];count:number}>();
 for(const t of triangles){let c=centres.get(t.pieceId);if(!c){c={sum:[0,0,0],count:0};centres.set(t.pieceId,c);}for(const p of t.points){c.count++;for(let i=0;i<3;i++){c.sum[i]+=p[i];min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}}}
 const centre=min.map((v,i)=>Number.isFinite(v)?(v+max[i])/2:0),size=Math.max(1,...min.map((v,i)=>Number.isFinite(v)?max[i]-v:0));
 const offsets=new Map([...centres].map(([id,c])=>{const delta=c.sum.map((v,i)=>v/c.count-centre[i]),length=Math.hypot(...delta);return [id,length?delta.map(v=>v/length*size*.35):[0,0,0]] as const;}));
 const items:Item[]=[...triangles.map(t=>({pieceId:t.pieceId,color:t.color,rings:[t.points],layer:0,offset:offsets.get(t.pieceId)!})),...overlays.map(t=>({...t,layer:1,offset:offsets.get(t.pieceId)??[0,0,0]}))];
 // Even-odd marking holes use the exact Canvas path fallback. Color-separated
 // trims already contain their final material color and need no overlay.
 const gl=overlays.length?null:canvas.getContext('webgl',{alpha:true,antialias:true,preserveDrawingBuffer:true});
 let gpu:ReturnType<typeof gpuRenderer>|undefined;
 if(gl)gpu=gpuRenderer(gl,triangles,centre,offsets,size);
 const ctx=gl?null:canvas.getContext('2d');
 const projected=items.map(t=>t.rings.map(r=>new Float64Array(r.length*3))),depths=new Float64Array(items.length);let active:number[]=[];
 let previous='';
 function draw(camera:AssemblyCamera,chosen:string[]){const start=performance.now(),box=canvas.getBoundingClientRect(),ratio=devicePixelRatio,w=Math.max(1,Math.round(box.width*ratio)),h=Math.max(1,Math.round(box.height*ratio));if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
  const selected=new Set(chosen),key=chosen.join(',');if(key!==previous){active=items.flatMap((t,i)=>selected.has(t.pieceId)?[i]:[]);previous=key;gpu?.select(selected);}
  const scale=Math.min(box.width,box.height)*.72/(size*(1+camera.explode*.7))*camera.zoom;
  if(gpu)gpu.draw(camera,scale*ratio,w,h);
  else if(ctx){ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,box.width,box.height);const cy=Math.cos(camera.yaw),sy=Math.sin(camera.yaw),cp=Math.cos(camera.pitch),sp=Math.sin(camera.pitch);
   for(const index of active){const t=items[index];let depth=0,count=0;for(let r=0;r<t.rings.length;r++){const ring=t.rings[r],out=projected[index][r];for(let j=0;j<ring.length;j++){const p=ring[j],x=p[0]-centre[0]+t.offset[0]*camera.explode,y=p[1]-centre[1]+t.offset[1]*camera.explode,z=p[2]-centre[2]+t.offset[2]*camera.explode,rx=x*cy+z*sy,rz=z*cy-x*sy;out[j*3]=box.width/2+rx*scale;out[j*3+1]=box.height/2-(y*cp-rz*sp)*scale;out[j*3+2]=y*sp+rz*cp;depth+=out[j*3+2];count++;}}if(t.depthPoints){depth=0;count=t.depthPoints.length;for(const p of t.depthPoints){const x=p[0]-centre[0]+t.offset[0]*camera.explode,y=p[1]-centre[1]+t.offset[1]*camera.explode,z=p[2]-centre[2]+t.offset[2]*camera.explode;depth+=y*sp+(z*cy-x*sy)*cp;}}depths[index]=depth/Math.max(1,count);}
   active.sort((a,b)=>Math.abs(depths[a]-depths[b])<size*1e-10?items[a].layer-items[b].layer:depths[a]-depths[b]);
   for(const index of active){const t=items[index];ctx.beginPath();for(const r of projected[index]){for(let i=0;i<r.length;i+=3)if(i)ctx.lineTo(r[i],r[i+1]);else ctx.moveTo(r[i],r[i+1]);ctx.closePath();}ctx.fillStyle=t.color;ctx.fill('evenodd');if(!t.layer){ctx.strokeStyle=t.color;ctx.lineWidth=.4;ctx.stroke();}}
  }
  canvas.dataset.renderer=gpu?'webgl':'canvas';canvas.dataset.triangles=String(triangles.filter(t=>selected.has(t.pieceId)).length);canvas.dataset.drawMs=(performance.now()-start).toFixed(2);
 }
 return {draw,dispose:()=>gpu?.dispose()};
}
function gpuRenderer(gl:WebGLRenderingContext,triangles:AssemblyTriangle[],centre:number[],offsets:ReadonlyMap<string,readonly number[]>,size:number){
 const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)??'Assembly shader');return s;};
 const vertex=shader(gl.VERTEX_SHADER,`attribute vec3 position;attribute vec3 offset;attribute vec3 color;uniform vec4 rotation;uniform vec3 scale;uniform float explode;varying vec3 fill;void main(){vec3 p=position+offset*explode;float x=p.x*rotation.x+p.z*rotation.y;float z=p.z*rotation.x-p.x*rotation.y;float y=p.y*rotation.z-z*rotation.w;float depth=p.y*rotation.w+z*rotation.z;gl_Position=vec4(x*scale.x,y*scale.y,-depth*scale.z,1.);fill=color;}`),fragment=shader(gl.FRAGMENT_SHADER,`precision mediump float;varying vec3 fill;void main(){gl_FragColor=vec4(fill,1.);}`),program=gl.createProgram()!;
 gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Assembly program');gl.useProgram(program);
 const buffer=gl.createBuffer()!,rotation=gl.getUniformLocation(program,'rotation'),scale=gl.getUniformLocation(program,'scale'),explode=gl.getUniformLocation(program,'explode');let count=0;
 const attributes=['position','offset','color'].map(name=>gl.getAttribLocation(program,name));
 function select(selected:Set<string>){const active=triangles.filter(t=>selected.has(t.pieceId)),data=new Float32Array(active.length*27);let i=0;for(const t of active){const color=[1,3,5].map(n=>parseInt(t.color.slice(n,n+2),16)/255),offset=offsets.get(t.pieceId)!;for(const p of t.points){for(let j=0;j<3;j++)data[i++]=p[j]-centre[j];for(const v of offset)data[i++]=v;for(const v of color)data[i++]=v;}}count=active.length*3;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);attributes.forEach((a,j)=>{gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,3,gl.FLOAT,false,36,j*12);});}
 function draw(c:AssemblyCamera,pixels:number,w:number,h:number){gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.uniform4f(rotation,Math.cos(c.yaw),Math.sin(c.yaw),Math.cos(c.pitch),Math.sin(c.pitch));gl.uniform3f(scale,pixels*2/w,pixels*2/h,1/(size*3));gl.uniform1f(explode,c.explode);gl.drawArrays(gl.TRIANGLES,0,count);}
 return {select,draw,dispose(){gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);}};
}

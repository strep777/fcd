import type {Marking,Surface} from '../schema/index';

export type Vector3=[number,number,number];
export type RenderFace={id:string;vertices:[string,string,string];color:string};
export type RenderCamera={cx:number;cy:number;cz:number;extent:number;factor:number;yaw:number;pitch:number;panX:number;panY:number;perspective:boolean;zoom:number};
export const surfaceVertexStride=11;
/** Position-only unique mesh edges. Display data never changes topology or source coordinates. */
export function surfaceWireVertices(surface:Pick<Surface,'vertices'|'faces'>,center:Pick<RenderCamera,'cx'|'cy'|'cz'>){
 const vertices=new Map(surface.vertices.map((point,index)=>[point.id,{point,index}])),seen=new Set<string>(),positions=new Float32Array(surface.faces.length*18);let count=0;
 for(const face of surface.faces)for(let i=0;i<3;i++){
  const a=vertices.get(face.vertices[i]),b=vertices.get(face.vertices[(i+1)%3]);if(!a||!b)continue;
  const key=a.index<b.index?a.index+':'+b.index:b.index+':'+a.index;if(seen.has(key))continue;seen.add(key);
  for(const {point} of [a,b]){positions[count++]=point.xMm-center.cx;positions[count++]=point.yMm-center.cy;positions[count++]=point.zMm-center.cz;}
 }
 return positions.slice(0,count);
}
export const neutralSurfaceColor='#b9bec6';
const dot=(a:Vector3,b:Vector3)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
const unit=(v:Vector3):Vector3=>{const length=Math.hypot(...v);return length>1e-14?v.map(value=>value/length) as Vector3:[0,0,1];};
const difference=(a:Surface['vertices'][number],b:Surface['vertices'][number]):Vector3=>[a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm];

/** Angle-weighted display normals. Region/cut boundaries do not change geometry or shading.
 * Real creases remain sharp; IDs keep disconnected coincident surfaces independent. */
export function surfaceCornerNormals(surface:Pick<Surface,'vertices'|'faces'>,creaseDegrees=65){
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),corners=new Map<string,{faceId:string;normal:Vector3;angle:number}[]>(),faceNormals=new Map<string,Vector3>();
 for(const face of surface.faces){const points=face.vertices.map(id=>vertices.get(id)!);if(points.some(p=>!p))continue;const a=difference(points[1],points[0]),b=difference(points[2],points[0]),normal=unit([a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]);faceNormals.set(face.id,normal);
  points.forEach((p,i)=>{const a=unit(difference(points[(i+1)%3],p)),b=unit(difference(points[(i+2)%3],p)),angle=Math.acos(Math.max(-1,Math.min(1,dot(a,b)))),id=face.vertices[i];corners.set(id,[...(corners.get(id)??[]),{faceId:face.id,normal,angle}]);});
 }
 const threshold=Math.cos(creaseDegrees*Math.PI/180),result=new Map<string,[Vector3,Vector3,Vector3]>();
 for(const face of surface.faces){const normal=faceNormals.get(face.id);if(!normal)continue;result.set(face.id,face.vertices.map(id=>{const sum:Vector3=[0,0,0];for(const corner of corners.get(id)??[])if(dot(normal,corner.normal)>=threshold-1e-10)corner.normal.forEach((value,i)=>sum[i]+=value*corner.angle);return unit(sum);}) as [Vector3,Vector3,Vector3]);}
 return result;
}
export function surfaceViewNormal(normal:Vector3,yaw:number,pitch:number):Vector3{const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),z=-normal[0]*sy+normal[2]*cy;return [normal[0]*cy+normal[2]*sy,normal[1]*cp-z*sp,normal[1]*sp+z*cp];}
/** Broad studio lights preserve dark marking legibility and avoid hard specular highlights. */
export function surfaceLight(normal:Vector3){let n=unit(normal);if(n[2]<0)n=n.map(v=>-v) as Vector3;return .62+.28*Math.max(0,dot(n,unit([-.45,.65,1])))+.10*Math.max(0,dot(n,unit([.8,.15,.5])));}
export function colorChannels(color:string):Vector3{return [1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255) as Vector3;}
export function shadedColor(color:string,light:number){if(light===1||!/^#[0-9a-f]{6}$/i.test(color))return color;return '#'+colorChannels(color).map(v=>Math.round(Math.max(0,Math.min(1,v*light))*255).toString(16).padStart(2,'0')).join('');}
/** Linear Gouraud light field for the software fallback, using the same corner lights. */
export function surfaceLightGradient(points:{x:number;y:number}[],lights:number[]){const [a,b,c]=points,den=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(Math.abs(den)<1e-10)return null;const dx=((lights[1]-lights[0])*(c.y-a.y)-(lights[2]-lights[0])*(b.y-a.y))/den,dy=((b.x-a.x)*(lights[2]-lights[0])-(c.x-a.x)*(lights[1]-lights[0]))/den,length2=dx*dx+dy*dy;if(length2<1e-12)return null;const min=Math.min(...lights),max=Math.max(...lights);return {x0:a.x+dx*(min-lights[0])/length2,y0:a.y+dy*(min-lights[0])/length2,x1:a.x+dx*(max-lights[0])/length2,y1:a.y+dy*(max-lights[0])/length2,min,max};}

function appendVertex(array:number[],point:Surface['vertices'][number],normal:Vector3,color:Vector3,uv:number[],center:Pick<RenderCamera,'cx'|'cy'|'cz'>){array.push(point.xMm-center.cx,point.yMm-center.cy,point.zMm-center.cz,...uv,...color,...normal);}
export function surfaceRenderGroups(surface:Surface,faces:RenderFace[],center:Pick<RenderCamera,'cx'|'cy'|'cz'>,normals=surfaceCornerNormals(surface)){
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),mapping=new Map(surface.textureFaces?.map(f=>[f.faceId,f])),groups=new Map<string,number[]>();
 for(const face of faces){const corners=normals.get(face.id),points=face.vertices.map(id=>vertices.get(id));if(!corners||points.some(p=>!p))continue;const uv=mapping.get(face.id),key=uv?.textureId??'',array=groups.get(key)??[],color=colorChannels(face.color);points.forEach((point,i)=>appendVertex(array,point!,corners[i],color,uv?.uv[i]??[0,0],center));groups.set(key,array);}
 return groups;
}
/** Fan triangles are a parity mask, not a polygon triangulation. Stencil INVERT gives
 * exact even-odd concave rings and holes while depth-testing the real face plane.
 * Separate fragments on the same face paint a union, so they need separate stencil
 * clears. Distinct-face fragments share a batch; ordinary markings still use one. */
export function surfaceMarkingBatches(surface:Surface,markings:Pick<Marking,'surfaceId'|'topologyVersion'|'color'|'fragments'>[],center:Pick<RenderCamera,'cx'|'cy'|'cz'>,normals=surfaceCornerNormals(surface)){
 const vertices=new Map(surface.vertices.map(v=>[v.id,v])),faces=new Map(surface.faces.map(f=>[f.id,f]));
 return markings.filter(m=>m.surfaceId===surface.id&&m.topologyVersion===surface.topologyVersion).flatMap(marking=>{const batches:{mask:number[];fill:number[]}[]=[],faceCounts=new Map<string,number>(),color=colorChannels(marking.color);
  for(const fragment of marking.fragments){const face=faces.get(fragment.faceId),corners=normals.get(fragment.faceId);if(!face||!corners)continue;const triangle=face.vertices.map(id=>vertices.get(id)!);if(triangle.some(v=>!v))continue;
   const index=faceCounts.get(fragment.faceId)??0;faceCounts.set(fragment.faceId,index+1);const batch=batches[index]??(batches[index]={mask:[],fill:[]}),{mask,fill}=batch;
   for(const ring of fragment.rings){const points=ring.map(weights=>{const p={id:'',xMm:0,yMm:0,zMm:0},n:Vector3=[0,0,0];weights.forEach((weight,i)=>{p.xMm+=weight*triangle[i].xMm;p.yMm+=weight*triangle[i].yMm;p.zMm+=weight*triangle[i].zMm;corners[i].forEach((value,j)=>n[j]+=weight*value);});return {p,n:unit(n)};});for(let i=1;i<points.length-1;i++)for(const point of [points[0],points[i],points[i+1]])appendVertex(mask,point.p,point.n,color,[0,0],center);}
   triangle.forEach((point,i)=>appendVertex(fill,point,corners[i],color,[0,0],center));
  }
  return batches;
 }).filter(batch=>batch.mask.length);
}

export const surfaceVertexSource=`attribute vec3 position;attribute vec2 uv;attribute vec3 color;attribute vec3 normal;
uniform mat3 rotation;uniform vec2 viewportScale;uniform vec2 pan;uniform float factor;uniform float distance;uniform float extent;uniform float perspective;uniform float depthBias;
varying vec2 texUv;varying vec3 faceColor;varying vec3 viewNormal;
void main(){vec3 p=rotation*position;float w=mix(1.0,distance-p.z,perspective);float gain=mix(1.0,distance,perspective);float near=max(0.01,distance-2.0*extent);float far=distance+2.0*extent;float z=mix(-p.z/(2.0*extent),((far+near)/(far-near))*w-2.0*far*near/(far-near),perspective);gl_Position=vec4(p.xy*factor*gain*viewportScale+pan*w,z-depthBias*w,w);texUv=uv;faceColor=color;viewNormal=rotation*normal;}`;
export const surfaceFragmentSource=`precision mediump float;varying vec2 texUv;varying vec3 faceColor;varying vec3 viewNormal;uniform sampler2D image;uniform float textured;uniform float lighting;
void main(){vec3 n=normalize(viewNormal);if(n.z<0.0)n=-n;float light=0.62+0.28*max(0.0,dot(n,normalize(vec3(-0.45,0.65,1.0))))+0.10*max(0.0,dot(n,normalize(vec3(0.8,0.15,0.5))));vec3 c=mix(faceColor,texture2D(image,texUv).rgb,textured);gl_FragColor=vec4(c*mix(1.0,light,lighting),1.0);}`;

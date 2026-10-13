import type {Surface} from '../schema/index';
export function meshBounds(vertices:Surface['vertices']){
 let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
 for(const v of vertices){minX=Math.min(minX,v.xMm);maxX=Math.max(maxX,v.xMm);minY=Math.min(minY,v.yMm);maxY=Math.max(maxY,v.yMm);minZ=Math.min(minZ,v.zMm);maxZ=Math.max(maxZ,v.zMm);}
 return {cx:(minX+maxX)/2,cy:(minY+maxY)/2,cz:(minZ+maxZ)/2,extent:Math.max(maxX-minX,maxY-minY,maxZ-minZ,1),minX,minY,minZ};
}
/** Display-only vertex clustering. Never used to manufacture, unwrap or pick an original face. */
export function previewLod(mesh:Surface,budget=12000){
 if(mesh.faces.length<=budget)return {vertices:mesh.vertices,faces:mesh.faces,errorMm:0,sourceFaces:new Map(mesh.faces.map(f=>[f.id,[f.id]]))};
 const bounds=meshBounds(mesh.vertices);let cell=bounds.extent/80;
 for(let pass=0;pass<12;pass++,cell*=1.5){
 const clusters=new Map<string,{id:string;x:number;y:number;z:number;n:number}>(),owners=new Map<string,string>();
 for(const v of mesh.vertices){const key=[Math.floor((v.xMm-bounds.minX)/cell),Math.floor((v.yMm-bounds.minY)/cell),Math.floor((v.zMm-bounds.minZ)/cell)].join(':');let c=clusters.get(key);if(!c){c={id:v.id,x:0,y:0,z:0,n:0};clusters.set(key,c);}c.x+=v.xMm;c.y+=v.yMm;c.z+=v.zMm;c.n++;owners.set(v.id,c.id);}
 const vertices=[...clusters.values()].map(c=>({id:c.id,xMm:c.x/c.n,yMm:c.y/c.n,zMm:c.z/c.n})),byId=new Map(vertices.map(v=>[v.id,v])),faces:Surface['faces']=[],seen=new Map<string,string>(),sourceFaces=new Map<string,string[]>();let errorMm=0;
 for(const v of mesh.vertices){const p=byId.get(owners.get(v.id)!)!;errorMm=Math.max(errorMm,Math.hypot(p.xMm-v.xMm,p.yMm-v.yMm,p.zMm-v.zMm));}
 for(const f of mesh.faces){const ids=f.vertices.map(id=>owners.get(id)!) as [string,string,string];if(new Set(ids).size<3)continue;const key=ids.join(':')+':'+f.region,existing=seen.get(key);if(existing){sourceFaces.get(existing)!.push(f.id);continue;}seen.set(key,f.id);faces.push({...f,vertices:ids});sourceFaces.set(f.id,[f.id]);}
 if(faces.length<=budget&&faces.length)return {vertices,faces,errorMm,sourceFaces};
 }
 // Disconnected tiny parts may resist clustering. Preserve them rather than arbitrarily dropping faces.
 return {vertices:mesh.vertices,faces:mesh.faces,errorMm:0,sourceFaces:new Map(mesh.faces.map(f=>[f.id,[f.id]]))};
}
export type ScreenPoint={x:number;y:number;z:number;inverseDepth:number};
export function screenWeights(p:{x:number;y:number},triangle:ScreenPoint[]):[number,number,number]|null{
 const [a,b,c]=triangle,den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-10)return null;
 const u=((b.y-c.y)*(p.x-c.x)+(c.x-b.x)*(p.y-c.y))/den,v=((c.y-a.y)*(p.x-c.x)+(a.x-c.x)*(p.y-c.y))/den,w=1-u-v;
 return Math.min(u,v,w)>=-1e-8?[u,v,w]:null;
}

/** Canvas bitmap and picking use the same CSS content box, excluding borders/padding. */
export function canvasViewport(element:HTMLCanvasElement){const r=element.getBoundingClientRect(),style=getComputedStyle(element),value=(s:string)=>parseFloat(s)||0,left=value(style.borderLeftWidth)+value(style.paddingLeft),right=value(style.borderRightWidth)+value(style.paddingRight),top=value(style.borderTopWidth)+value(style.paddingTop),bottom=value(style.borderBottomWidth)+value(style.paddingBottom),width=Math.max(1,r.width-left-right),height=Math.max(1,r.height-top-bottom);return {x:r.x+left,y:r.y+top,width,height,scale:Math.min(width/720,height/540)};}

import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import type Module from 'manifold-3d';
import type {Manifold} from 'manifold-3d';
import {surfaceSchema,type Surface} from '../../../packages/schema/index';
import {DomainError} from './repository';
import {validateSurface} from './surface';
/** Close each original recipe part and union solids, keeping part provenance from Manifold run IDs. */
export async function assembleSpecies(source:Surface,assetDirectory=existsSync('node_modules/manifold-3d')?resolve('node_modules/manifold-3d'):resolve('dist/assets')):Promise<Surface>{
 if(!source.template||source.source!=='species-template-1'||source.assembly)throw new DomainError('TEMPLATE_REQUIRED');
 const load=(await import(pathToFileURL(resolve(assetDirectory,assetDirectory.endsWith('manifold-3d')?'manifold.js':'manifold.mjs')).href)).default as typeof Module;
 const wasm=await load({locateFile:()=>resolve(assetDirectory,'manifold.wasm')});wasm.setup();
 const owned:Manifold[]=[];const hold=(m:Manifold)=>{owned.push(m);return m;};
 try{
 const vertices=new Map(source.vertices.map(v=>[v.id,v])),parts=[...source.template.parts].sort((a,b)=>b.length-a.length),groups=new Map(parts.map(name=>[name,[] as Surface['faces']]));
 for(const face of source.faces){const part=parts.find(p=>face.region===p||face.region.startsWith(p+'-'));if(!part)throw new DomainError('TEMPLATE_REGIONS_CHANGED');groups.get(part)!.push(face);}
 const start=wasm.Manifold.reserveIDs(parts.length),labels=new Map<number,string>(),solids:Manifold[]=[];
 for(const [part,group] of groups){if(!group.length)throw new DomainError('TEMPLATE_REGIONS_CHANGED');
 const ids=[...new Set(group.flatMap(f=>f.vertices))],indices=new Map(ids.map((id,i)=>[id,i])),positions=ids.map(id=>{const v=vertices.get(id)!;return [v.xMm,v.yMm,v.zMm];}),triangles=group.map(f=>f.vertices.map(id=>indices.get(id)!) as [number,number,number]);
 const edges=new Map<string,{a:number;b:number;count:number}>();for(const triangle of triangles)triangle.forEach((a,i)=>{const b=triangle[(i+1)%3],key=[a,b].sort((x,y)=>x-y).join(':');const e=edges.get(key);if(e)e.count++;else edges.set(key,{a,b,count:1});});
 if(part.startsWith('wing-')&&[...edges.values()].some(e=>e.count===1)){
 // Wings are recipe panels: make a 2 mm solid prism before union, rather than a zero-volume cap.
 const n=positions.length;positions.push(...positions.map(([x,y,z])=>[x,y,z+2]));const base=triangles.map(t=>[...t] as [number,number,number]);triangles.splice(0,triangles.length,...base.map(([a,b,c])=>[a,c,b] as [number,number,number]),...base.map(([a,b,c])=>[a+n,b+n,c+n] as [number,number,number]));
 for(const e of edges.values())if(e.count===1)triangles.push([e.a,e.b,e.b+n],[e.a,e.b+n,e.a+n]);
 }else{
 const remaining=new Map([...edges.values()].filter(e=>e.count===1).map(e=>[e.a,e.b]));
 while(remaining.size){const first=remaining.keys().next().value!,ring=[first];let next=remaining.get(first)!;remaining.delete(first);while(next!==first){if(ring.includes(next)||!remaining.has(next))throw new DomainError('NON_MANIFOLD');ring.push(next);const following=remaining.get(next)!;remaining.delete(next);next=following;}
 const center=[0,0,0];for(const i of ring)positions[i].forEach((v,j)=>center[j]+=v/ring.length);const c=positions.length;positions.push(center);for(let i=0;i<ring.length;i++)triangles.push([c,ring[(i+1)%ring.length],ring[i]]);
 }
 }
 // Recipe primitives may be globally inward; signed volume determines consistent outward orientation.
 const volume=triangles.reduce((sum,[a,b,c])=>{const A=positions[a],B=positions[b],C=positions[c];return sum+(A[0]*(B[1]*C[2]-B[2]*C[1])+A[1]*(B[2]*C[0]-B[0]*C[2])+A[2]*(B[0]*C[1]-B[1]*C[0]))/6;},0);
 if(Math.abs(volume)<1e-5)throw new DomainError('DEGENERATE_PART');if(volume<0)triangles.forEach(t=>[t[1],t[2]]=[t[2],t[1]]);
 const originalId=start+labels.size;labels.set(originalId,part);
 const mesh=new wasm.Mesh({numProp:3,vertProperties:new Float32Array(positions.flat()),triVerts:new Uint32Array(triangles.flat()),runIndex:new Uint32Array([0,triangles.length*3]),runOriginalID:new Uint32Array([originalId])});
 const solid=hold(wasm.Manifold.ofMesh(mesh));if(solid.status()!=='NoError'||solid.volume()<=0)throw new DomainError('NON_MANIFOLD');solids.push(solid);
 }
 let union=hold(wasm.Manifold.union(solids));const components=union.decompose();owned.push(...components);if(components.length!==1)throw new DomainError('DISCONNECTED_TEMPLATE');
 // Keep the new rounded silhouettes and small paw features. A custom-template import budget
 // (3000 vertices / 5000 triangles) is unrelated to the supported 50000-face unwrap budget.
 const maxVertices=8000,maxFaces=12000;
 union=hold(union.simplify(.25));let toleranceMm=.25,mesh=union.getMesh();for(const tolerance of [.1,.25,.5]){if(mesh.numVert<=maxVertices&&mesh.numTri<=maxFaces)break;union=hold(union.simplify(tolerance));mesh=union.getMesh();toleranceMm+=tolerance;}
 union=hold(wasm.Manifold.ofMesh(mesh));mesh=union.getMesh();if(mesh.numVert>maxVertices||mesh.numTri>maxFaces)throw new DomainError('MESH_LIMIT');
 // Boolean intersections calculated in double precision can become almost-identical adjacent
 // vertices in the float32 output. Collapse only existing edges below one micron; spatially
 // nearby unconnected sheets must remain separate. Removing the two collapsed triangles
 // preserves the exterior and avoids impossible short-edge pieces during manufacturing.
 const roots=Array.from({length:mesh.numVert},(_,i)=>i),root=(i:number):number=>{while(roots[i]!==i){roots[i]=roots[roots[i]];i=roots[i];}return i;},roundingToleranceMm=.001;
 for(let i=0;i<mesh.numTri;i++)for(let j=0;j<3;j++){
  const a=mesh.triVerts[i*3+j],b=mesh.triVerts[i*3+(j+1)%3];
  if(Math.hypot(...[0,1,2].map(axis=>mesh.vertProperties[a*mesh.numProp+axis]-mesh.vertProperties[b*mesh.numProp+axis]))<roundingToleranceMm){const A=root(a),B=root(b);roots[Math.max(A,B)]=Math.min(A,B);}
 }
 const used=new Set<number>(),triangles:{indices:[number,number,number];region:string}[]=[];let run=0;
 for(let i=0;i<mesh.numTri;i++){
  while(run+1<mesh.runOriginalID.length&&i*3>=mesh.runIndex[run+1])run++;
  const region=labels.get(mesh.runOriginalID[run]);if(!region)throw new DomainError('ASSEMBLY_PROVENANCE');
  const indices=[0,1,2].map(j=>root(mesh.triVerts[i*3+j])) as [number,number,number];if(new Set(indices).size<3)continue;
  indices.forEach(v=>used.add(v));triangles.push({indices,region});
 }
 const vertexIndices=[...used],vertexIds=new Map(vertexIndices.map(i=>[i,randomUUID()]));
 const resultVertices=vertexIndices.map(i=>({id:vertexIds.get(i)!,xMm:mesh.vertProperties[i*mesh.numProp],yMm:mesh.vertProperties[i*mesh.numProp+1],zMm:mesh.vertProperties[i*mesh.numProp+2]}));
 const resultFaces:Surface['faces']=triangles.map(({indices,region})=>({id:randomUUID(),vertices:indices.map(i=>vertexIds.get(i)!) as [string,string,string],region}));
 const measurements:{name:string;targetMm:number;actualMm:number;residualMm:number}[]=[],add=(name:string,targetMm:number,actualMm:number)=>measurements.push({name,targetMm,actualMm,residualMm:actualMm-targetMm}),p=source.template.parameters;
 const bounds=union.boundingBox();add('height',p.heightMm,bounds.max[1]-bounds.min[1]);if(Math.abs(measurements[0].residualMm)>1)throw new DomainError('ASSEMBLY_DIMENSION_DRIFT');
 // Anatomical girths follow the costume's torso shell. Measuring the whole horizontal
 // silhouette counts a folded wing or lowered arm as chest/waist circumference.
 // Keep the measurement on the exact part solid used by the exterior union.
 const torso=solids[parts.indexOf('torso')];if(!torso)throw new DomainError('ASSEMBLY_MEASUREMENT');
 const rotated=hold(torso.rotate([90,0,0])),hip=p.legLengthMm,shoulderY=p.heightMm-p.earHeightMm-p.headLengthMm-70;
 for(const [name,y] of [['hipGirth',hip+.01],['waistGirth',hip+(shoulderY-hip)*.35],['chestGirth',hip+(shoulderY-hip)*.8],['neckGirth',p.heightMm-p.earHeightMm-p.headLengthMm]] as const){const cross=rotated.slice(y);try{const rings=cross.toPolygons();const centered=rings.filter(r=>{let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>0)!==(b[1]>0)&&0<(b[0]-a[0])*(-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;});if(centered.length!==1)throw new DomainError('ASSEMBLY_MEASUREMENT');const ring=centered[0],actual=ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+Math.hypot(a[0]-b[0],a[1]-b[1]);},0),target=source.template.measurements.find(m=>m.name===name)!.targetMm;add(name,target,actual);}finally{cross.delete();}}
 const result=surfaceSchema.parse({...source,id:randomUUID(),topologyVersion:source.topologyVersion+1,vertices:resultVertices,faces:resultFaces,cutConstraints:undefined,assembly:{algorithm:'manifold-union-3.5.4',sourceHash:createHash('sha256').update(JSON.stringify(source)).digest('hex'),components:1,volumeMm3:union.volume(),toleranceMm,inputFaces:source.faces.length,measurements},template:{...source.template,warnings:['ASSEMBLED_DIMENSIONS_REQUIRE_REVIEW','MANUFACTURING_TRIAL_REQUIRED']}});validateSurface(result);return result;
 }finally{for(const m of owned.reverse())m.delete();}
}


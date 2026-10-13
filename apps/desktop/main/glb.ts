import {textureAsset} from './texture-assets';
import {MESH_VERTICES,MESH_FACES,MESH_FILE_BYTES} from '../../../packages/surface/limits';
import {Document,NodeIO} from '@gltf-transform/core';
import {randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {surfaceSchema,type Surface} from '../../../packages/schema/index';
import {DomainError} from './repository';
import {validateSurface} from './surface';
/** Embedded GLB only. World transforms are baked; glTF metres become manufacturing millimetres. */
export async function parseGlb(bytes:Uint8Array,scale=1):Promise<Surface>{
 if(bytes.length>MESH_FILE_BYTES)throw new DomainError('MESH_LIMIT');
 if(!Number.isFinite(scale)||scale<=0||scale>10000)throw new DomainError('VALIDATION_ERROR');
 try{
 const io=new NodeIO(),jsonDoc=await io.binaryToJSON(bytes),json=jsonDoc.json;
 if(json.extensionsRequired?.length||json.animations?.length||json.skins?.length||json.nodes?.some(n=>n.extensions)||json.meshes?.some(m=>m.primitives.some(p=>p.extensions||p.targets?.length)))throw new DomainError('GLB_UNSUPPORTED');
 // Accessor counts must be bounded before the SDK allocates decoded arrays, including sparse accessors.
 if((json.accessors?.length??0)>10000||(json.accessors??[]).reduce((sum,a)=>sum+a.count,0)>MESH_FACES*12||json.accessors?.some(a=>a.count>MESH_FACES*3)||json.nodes&&json.nodes.length>3000)throw new DomainError('MESH_LIMIT');
 const doc=await io.readJSON(jsonDoc),root=doc.getRoot(),scene=root.getDefaultScene()??(root.listScenes().length===1?root.listScenes()[0]:null);
 if(!scene)throw new DomainError('GLB_SCENE_REQUIRED');
 const vertices:Surface['vertices']=[],faces:Surface['faces']=[],seen=new Set<string>(),textures:NonNullable<Surface['textures']>=[],textureFaces:NonNullable<Surface['textureFaces']>=[],materialTextures=new Map<object,string>();
 for(const material of root.listMaterials()){const texture=material.getBaseColorTexture(),info=material.getBaseColorTextureInfo();if(!texture)continue;if(!info||info.getTexCoord()!==0||info.listExtensions().length||material.getAlphaMode()!=='OPAQUE')throw new DomainError('GLB_TEXTURE_UNSUPPORTED');const bytes=texture.getImage();if(!bytes)throw new DomainError('INVALID_GLB');const asset=await textureAsset(bytes,material.getName()||texture.getName()||'Texture',material.getBaseColorFactor());if(textures.length>=8)throw new DomainError('TEXTURE_LIMIT');textures.push(asset);materialTextures.set(material,asset.id);}
 scene.traverse(node=>{
 const mesh=node.getMesh();if(!mesh)return;
 const matrix=node.getWorldMatrix(),det=matrix[0]*(matrix[5]*matrix[10]-matrix[6]*matrix[9])-matrix[4]*(matrix[1]*matrix[10]-matrix[2]*matrix[9])+matrix[8]*(matrix[1]*matrix[6]-matrix[2]*matrix[5]);
 if(!Number.isFinite(det)||Math.abs(det)<1e-12)throw new DomainError('DEGENERATE_MESH');
 const welded=new Map<string,string>();
 for(const primitive of mesh.listPrimitives()){
 if(primitive.getMode()!==4)throw new DomainError('GLB_TRIANGLES_REQUIRED');
 const positions=primitive.getAttribute('POSITION'),indices=primitive.getIndices();if(!positions||positions.getElementSize()!==3||indices&&indices.getElementSize()!==1)throw new DomainError('INVALID_MESH');
 const ids:string[]=[],material=primitive.getMaterial(),textureId=material?materialTextures.get(material):undefined,texcoords=textureId?primitive.getAttribute('TEXCOORD_0'):null;
 if(textureId&&primitive.getAttribute('COLOR_0'))throw new DomainError('GLB_TEXTURE_UNSUPPORTED');
 if(textureId&&(!texcoords||texcoords.getElementSize()!==2||texcoords.getCount()!==positions.getCount()))throw new DomainError('GLB_TEXTURE_UNSUPPORTED');
 for(let i=0;i<positions.getCount();i++){
 const p=positions.getElement(i,[]),xMm=(matrix[0]*p[0]+matrix[4]*p[1]+matrix[8]*p[2]+matrix[12])*1000*scale,yMm=(matrix[1]*p[0]+matrix[5]*p[1]+matrix[9]*p[2]+matrix[13])*1000*scale,zMm=(matrix[2]*p[0]+matrix[6]*p[1]+matrix[10]*p[2]+matrix[14])*1000*scale;
 if(![xMm,yMm,zMm].every(Number.isFinite))throw new DomainError('INVALID_MESH');
 const key=[xMm,yMm,zMm].join(','),existing=welded.get(key);if(existing){ids.push(existing);continue;}
 const id=randomUUID();welded.set(key,id);ids.push(id);vertices.push({id,xMm,yMm,zMm});if(vertices.length>MESH_VERTICES)throw new DomainError('MESH_LIMIT');
 }
 const count=indices?.getCount()??ids.length;if(count%3)throw new DomainError('GLB_TRIANGLES_REQUIRED');
 for(let i=0;i<count;i+=3){const triangle=[0,1,2].map(j=>{const index=indices?indices.getScalar(i+j):i+j;if(!Number.isInteger(index)||index<0||index>=ids.length)throw new DomainError('INVALID_MESH');return ids[index];}) as [string,string,string];if(det<0)[triangle[1],triangle[2]]=[triangle[2],triangle[1]];
 const textureUv=texcoords?[0,1,2].map(j=>texcoords.getElement(indices?indices.getScalar(i+j):i+j,[0,0]) as [number,number]):null;
 if(textureUv&&det<0)[textureUv[1],textureUv[2]]=[textureUv[2],textureUv[1]];
 if(textureUv?.some(uv=>uv.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new DomainError('GLB_TEXTURE_UNSUPPORTED');
 const faceId=randomUUID();if(textureUv&&textureId)textureFaces.push({faceId,textureId,uv:textureUv as [[number,number],[number,number],[number,number]]});
 const key=[...triangle].sort().join(':');if(seen.has(key))throw new DomainError('INVALID_MESH');seen.add(key);
 faces.push({id:faceId,vertices:triangle,region:(typeof primitive.getExtras().region==='string'?String(primitive.getExtras().region):node.getName()||mesh.getName()||'default').slice(0,80)});if(faces.length>MESH_FACES)throw new DomainError('MESH_LIMIT');
 }
 }
 });
 // Unused accessor vertices do not belong to the manufactured surface.
 const used=new Set(faces.flatMap(f=>f.vertices)),surface=surfaceSchema.parse({id:randomUUID(),topologyVersion:1,source:'glb',...(textures.length?{textures,textureFaces}:{}),vertices:vertices.filter(v=>used.has(v.id)),faces});validateSurface(surface);return surface;
 }catch(e){if(e instanceof DomainError)throw e;throw new DomainError('INVALID_GLB');}
}
export async function readGlb(path:string,scale:number){if((await stat(path)).size>MESH_FILE_BYTES)throw new DomainError('MESH_LIMIT');return parseGlb(await readFile(path),scale);}

export async function exportGlb(surface:Surface):Promise<Uint8Array>{
 validateSurface(surface);if(surface.textures?.length)return exportTexturedGlb(surface);const doc=new Document(),buffer=doc.createBuffer(),positions=doc.createAccessor().setType('VEC3').setArray(new Float32Array(surface.vertices.flatMap(v=>[v.xMm/1000,v.yMm/1000,v.zMm/1000]))).setBuffer(buffer),indices=new Map(surface.vertices.map((v,i)=>[v.id,i])),mesh=doc.createMesh('manufacturing-reference');
 for(const region of new Set(surface.faces.map(f=>f.region))){const array=new (surface.vertices.length>65535?Uint32Array:Uint16Array)(surface.faces.filter(f=>f.region===region).flatMap(f=>f.vertices.map(id=>indices.get(id)!))),accessor=doc.createAccessor().setType('SCALAR').setArray(array).setBuffer(buffer);mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION',positions).setIndices(accessor).setExtras({region}));}
 const node=doc.createNode('manufacturing-reference').setMesh(mesh).setExtras({unit:'metres',source:surface.source,sourceId:surface.id,topologyVersion:surface.topologyVersion,license:surface.customTemplate?.definition.license??surface.template?.license??'user-supplied',purpose:'geometry exchange; not cloth simulation'});doc.getRoot().setDefaultScene(doc.createScene().addChild(node));return new NodeIO().writeBinary(doc);
}

async function exportTexturedGlb(surface:Surface){
 const doc=new Document(),buffer=doc.createBuffer(),mesh=doc.createMesh('manufacturing-reference'),vertices=new Map(surface.vertices.map(v=>[v.id,v])),textureFaces=new Map(surface.textureFaces?.map(f=>[f.faceId,f])),materials=new Map(surface.textures!.map(t=>{const texture=doc.createTexture(t.name).setImage(new Uint8Array(Buffer.from(t.png.split(',')[1],'base64'))).setMimeType('image/png');return [t.id,doc.createMaterial(t.name).setBaseColorTexture(texture)];})),groups=new Map<string,Surface['faces']>();
 for(const face of surface.faces){const key=JSON.stringify([face.region,textureFaces.get(face.id)?.textureId??'']);let group=groups.get(key);if(!group){group=[];groups.set(key,group);}group.push(face);}
 for(const [key,faces] of groups){const [region,textureId]=JSON.parse(key) as string[],positions=new Float32Array(faces.flatMap(f=>f.vertices.flatMap(id=>{const v=vertices.get(id)!;return [v.xMm/1000,v.yMm/1000,v.zMm/1000];}))),primitive=doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer)).setExtras({region});if(textureId){const uv=new Float32Array(faces.flatMap(f=>textureFaces.get(f.id)!.uv.flat()));primitive.setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer)).setMaterial(materials.get(textureId)!);}mesh.addPrimitive(primitive);}
 doc.getRoot().setDefaultScene(doc.createScene().addChild(doc.createNode('manufacturing-reference').setMesh(mesh)));return new NodeIO().writeBinary(doc);
}

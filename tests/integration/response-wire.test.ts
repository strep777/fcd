import {beforeAll,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {createCanvas} from '@napi-rs/canvas';
import {encodeResponse,parseResponse} from '../../packages/api/response-wire';
import {desktopClient,type DesktopTransport} from '../../packages/api/client';
import {projectSchema,type Project,type Reference,type Response,type Surface} from '../../packages/schema/index';
import {project} from '../fixtures';
import {acceptedCutProject} from '../fixtures/accepted-cut';

type ImageAsset={mime:'image/png'|'image/jpeg'|'image/webp';url:string;sha256:string};
type Success=Extract<Response,{ok:true}>;
const imageSize=384,format='fpcad-response-images/1';
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
let images:{png:ImageAsset;otherPng:ImageAsset;jpeg:ImageAsset;webp:ImageAsset};
function makeImage(mime:ImageAsset['mime'],seed:number):ImageAsset{
 const canvas=createCanvas(imageSize,imageSize),context=canvas.getContext('2d'),pixels=context.createImageData(imageSize,imageSize);let state=seed;
 const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state&255;};
 for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=next();pixels.data[i+1]=next();pixels.data[i+2]=next();pixels.data[i+3]=255;}
 context.putImageData(pixels,0,0);
 const bytes=mime==='image/png'?canvas.toBuffer('image/png'):mime==='image/jpeg'?canvas.toBuffer('image/jpeg',95):canvas.toBuffer('image/webp',100);
 return {mime,url:'data:'+mime+';base64,'+bytes.toString('base64'),sha256:digest(bytes)};
}
beforeAll(()=>{
 images={png:makeImage('image/png',0x12345678),otherPng:makeImage('image/png',0x31415926),jpeg:makeImage('image/jpeg',0x10203040),webp:makeImage('image/webp',0x55667788)};
 for(const image of Object.values(images))expect(image.url.length,'fixture must exercise a real image above 64 KiB').toBeGreaterThan(64*1024);
});

function reply(value:Project|null):Success{
 return {ok:true,data:{sessionId:randomUUID(),project:value,geometry:[],canUndo:true,canRedo:false,savedRevision:value?.revision??null,recovery:[0],history:[],recent:[],jobs:[]}};
}
function reference(view:'front'|'back',source:ImageAsset):Reference{
 const png=images.png,variant={width:imageSize,height:imageSize,png:png.url,sha256:png.sha256,scaleX:1,scaleY:1};
 return {id:randomUUID(),name:view==='front'?'正面 🦊':'背面・原図',view,width:imageSize,height:imageSize,png:png.url,
  sheet:{id:randomUUID(),width:imageSize,height:imageSize,x:0,y:0,png:png.url},
  resources:{version:1,source:{mime:source.mime,width:imageSize,height:imageSize,orientation:1,data:source.url,sha256:source.sha256,transform:[1,0,0,1,0,0]},original:{sha256:png.sha256},proxy:{...variant},thumbnail:{...variant}}};
}
function referenceReply(kind:keyof Pick<typeof images,'png'|'jpeg'|'webp'>):Success{
 const value=project();value.references=[reference('front',images[kind]),reference('back',images[kind])];
 return reply(projectSchema.parse(value));
}
const jsonValue=(value:unknown):any=>JSON.parse(JSON.stringify(value));
function occurrences(value:unknown,image:string):number{
 if(typeof value==='string')return value===image?1:0;
 if(Array.isArray(value))return value.reduce((sum,entry)=>sum+occurrences(entry,image),0);
 if(value&&typeof value==='object')return Object.values(value).reduce<number>((sum,entry)=>sum+occurrences(entry,image),0);
 return 0;
}
function freeze(value:unknown){if(value&&typeof value==='object'){Object.freeze(value);for(const nested of Object.values(value))freeze(nested);}}
function envelope(){const encoded=JSON.parse(encodeResponse(referenceReply('jpeg')));expect(encoded.format).toBe(format);return encoded;}

it.each(['png','jpeg','webp'] as const)('transfers repeated %s originals and every dual-reference image field once with a complete response round trip',kind=>{
 const original=referenceReply(kind),expected=jsonValue(original),legacy=JSON.stringify(original),encoded=encodeResponse(original),wire=JSON.parse(encoded);
 expect(wire.format).toBe(format);
 for(const source of new Set([images.png.url,images[kind].url])){
  expect(occurrences(expected,source)).toBeGreaterThan(1);
  expect(occurrences(wire,source),'repeated original bytes must appear only in the reply image table').toBe(1);
 }
 expect(encoded.length).toBeLessThan(legacy.length);
 expect(parseResponse(encoded)).toStrictEqual(expected);
});

it('preserves current, saved-model and accepted-cut texture originals and proxies while transferring shared bytes once',()=>{
 const value=acceptedCutProject();
 const attach=(surface:Surface)=>{
  const texture={id:randomUUID(),name:'共用纹理 / texture',width:imageSize,height:imageSize,png:images.png.url,sha256:images.png.sha256,proxy:{width:imageSize,height:imageSize,png:images.otherPng.url}};
  surface.textures=[texture,{...structuredClone(texture),id:randomUUID(),name:'另一材质共用同一原图'}];
  surface.textureFaces=surface.faces.map(face=>({faceId:face.id,textureId:texture.id,uv:[[0,0],[1,0],[0,1]] as [[number,number],[number,number],[number,number]]}));
 };
 attach(value.surface!);const sourceHash=digest(JSON.stringify(value.surface));
 value.surfaceRun!.sourceHash=sourceHash;for(const binding of value.bindings??[])binding.surfaceHash=sourceHash;
 for(const binding of value.surfaceRun!.bindings)binding.surfaceHash=sourceHash;
 value.modelLibrary=[{id:value.surface!.id,name:'已保存模型 🦊',surface:structuredClone(value.surface!)}];
 const historical=value.cuttingLibrary![0];historical.surface=structuredClone(value.surface!);historical.run.sourceHash=sourceHash;for(const binding of historical.run.bindings)binding.surfaceHash=sourceHash;
 const original=reply(projectSchema.parse(value)),encoded=encodeResponse(original),wire=JSON.parse(encoded);
 for(const image of [images.png.url,images.otherPng.url]){
  expect(occurrences(original,image)).toBeGreaterThan(2);expect(occurrences(wire,image)).toBe(1);
 }
 expect(parseResponse(encoded)).toStrictEqual(jsonValue(original));
});

it('keeps millimetre doubles, subnormal coordinates, Unicode and ordinary reference-like text exact',()=>{
 const original=referenceReply('webp'),value=original.data.project!;
 value.name='兽装🦊・Café / e\u0301';value.defaultAllowanceMm=0.30000000000000004;
 value.pieces[0].nodes[0].xMm=0.12345678901234566;value.pieces[0].nodes[0].yMm=Number.MIN_VALUE;
 value.pieces[0].nodes[1].xMm=999999.9999999999;value.pieces[0].furRad=0.9876543210987654;
 value.workflow=[{key:'制作记录',title:'繋ぎ目 🧵',notes:'fpcad-image:0',completed:false}];
 const expected=jsonValue(original),decoded=parseResponse(encodeResponse(original)) as Success;
 expect(decoded).toStrictEqual(expected);
 for(const axis of ['xMm','yMm'] as const)expect(Object.is(decoded.data.project!.pieces[0].nodes[0][axis],value.pieces[0].nodes[0][axis])).toBe(true);
 expect(decoded.data.project!.workflow![0].notes).toBe('fpcad-image:0');
});

it('does not mutate frozen caller-owned responses or image containers while encoding',()=>{
 const original=referenceReply('jpeg'),before=JSON.stringify(original);freeze(original);
 const decoded=parseResponse(encodeResponse(original));
 expect(JSON.stringify(original)).toBe(before);expect(decoded).toStrictEqual(JSON.parse(before));
});

it('restores compact image replies through the public desktop client before publishing their session data',async()=>{
 const original=referenceReply('jpeg'),wire=encodeResponse(original);
 const client=desktopClient({read:async()=>wire} as DesktopTransport);
 expect(await client.read()).toStrictEqual(jsonValue(original));
});

it.each(['project','no project','error'] as const)('accepts legacy plain JSON for a %s reply',kind=>{
 const original=kind==='project'?reply(project()):kind==='no project'?reply(null):{ok:false,error:{code:'IO_ERROR',messageKey:'IO_ERROR'}};
 const legacy=JSON.stringify(original);
 expect(parseResponse(legacy)).toStrictEqual(JSON.parse(legacy));
 expect(JSON.parse(encodeResponse(original))).toStrictEqual(JSON.parse(legacy));
});

it('keeps a unique large image in the legacy response shape',()=>{
 const value=project();value.references=[{id:randomUUID(),name:'Unique original',view:'front',width:imageSize,height:imageSize,png:images.png.url}];
 const original=reply(projectSchema.parse(value)),wire=JSON.parse(encodeResponse(original));
 expect(wire).toStrictEqual(jsonValue(original));expect(parseResponse(JSON.stringify(wire))).toStrictEqual(jsonValue(original));
});

it('keeps repeated small images in the legacy response shape',()=>{
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',value=project();
 value.references=(['front','back'] as const).map(view=>({id:randomUUID(),name:view,view,width:1,height:1,png}));
 const original=reply(projectSchema.parse(value));expect(JSON.parse(encodeResponse(original))).toStrictEqual(jsonValue(original));
});

it.each(['missing images','missing response','invalid table','non-image entry','empty table','invalid response','extra envelope field','unknown version'] as const)('rejects an image envelope with %s',damage=>{
 const wire=envelope();
 if(damage==='missing images')delete wire.images;
 else if(damage==='missing response')delete wire.response;
 else if(damage==='invalid table')wire.images={};
 else if(damage==='non-image entry')wire.images[0]='not an embedded image';
 else if(damage==='empty table')wire.images=[];
 else if(damage==='invalid response')wire.response={ok:false,error:{code:'IO_ERROR',messageKey:'IO_ERROR'}};
 else if(damage==='extra envelope field')wire.extra=true;
 else wire.format='fpcad-response-images/999';
 expect(()=>parseResponse(JSON.stringify(wire))).toThrow();
});

it.each(['outside table','negative','fractional','leading zero','unsafe integer','not numeric'] as const)('rejects an encoded image reference that is %s',damage=>{
 const wire=envelope(),valid=wire.response.data.project.references[0].png as string,prefix=valid.slice(0,valid.lastIndexOf(':')+1);
 const suffix=damage==='outside table'?String(wire.images.length):damage==='negative'?'-1':damage==='fractional'?'0.5':damage==='leading zero'?'01':damage==='unsafe integer'?'9007199254740992':'missing';
 wire.response.data.project.references[0].png=prefix+suffix;
 expect(()=>parseResponse(JSON.stringify(wire))).toThrow();
});

it('rejects an unused image-table entry rather than accepting an incomplete envelope',()=>{
 const wire=envelope();wire.images.push(images.webp.url);
 expect(()=>parseResponse(JSON.stringify(wire))).toThrow();
});

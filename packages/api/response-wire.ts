const format='fpcad-response-images/1',imagePrefix='fpcad-image:',minimumImageLength=65536;
const embeddedImage=/^data:image\/(?:png|jpeg|webp);base64,/;
type RecordValue=Record<string,unknown>;
const record=(value:unknown):value is RecordValue=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Copy only image containers. Geometry and all other response values remain
 * untouched; the table exists for this reply only, never across revisions. */
function mapImages(value:unknown,image:(value:string)=>string):unknown{
 if(!record(value)||!record(value.data)||!record(value.data.project))return value;
 const field=(value:unknown)=>typeof value==='string'?image(value):value;
 const variant=(value:unknown)=>record(value)?{...value,png:field(value.png)}:value;
 const surface=(value:unknown)=>record(value)&&Array.isArray(value.textures)?{...value,textures:value.textures.map(texture=>record(texture)?{...texture,png:field(texture.png),...(texture.proxy===undefined?{}:{proxy:variant(texture.proxy)})}:texture)}:value;
 const reference=(value:unknown)=>{
  if(!record(value))return value;
  const resources=value.resources;
  return {...value,png:field(value.png),...(value.sheet===undefined?{}:{sheet:record(value.sheet)&&value.sheet.png!==undefined?variant(value.sheet):value.sheet}),...(record(resources)?{resources:{...resources,source:record(resources.source)?{...resources.source,data:field(resources.source.data)}:resources.source,proxy:variant(resources.proxy),thumbnail:variant(resources.thumbnail)}}:{})};
 };
 const project=value.data.project;
 const library=(value:unknown)=>Array.isArray(value)?value.map(entry=>record(entry)?{...entry,surface:surface(entry.surface)}:entry):value;
 return {...value,data:{...value.data,project:{...project,...(project.references===undefined?{}:{references:Array.isArray(project.references)?project.references.map(reference):project.references}),...(project.surface===undefined?{}:{surface:surface(project.surface)}),...(project.modelLibrary===undefined?{}:{modelLibrary:library(project.modelLibrary)}),...(project.cuttingLibrary===undefined?{}:{cuttingLibrary:library(project.cuttingLibrary)})}}};
}

/** Large originals commonly occur in both reference.png and source.data, or
 * in several model snapshots. Transfer their bytes once without recompression. */
export function encodeResponse(response:unknown):string{
 if(!record(response)||response.ok!==true)return JSON.stringify(response);
 const images:string[]=[],indices=new Map<string,number>();let shared=false;
 const compact=mapImages(response,value=>{
  if(value.length<minimumImageLength||!embeddedImage.test(value))return value;
  let index=indices.get(value);
  if(index===undefined){index=images.length;indices.set(value,index);images.push(value);}else shared=true;
  return imagePrefix+index;
 });
 return JSON.stringify(shared?{format,images,response:compact}:response);
}

/** Legacy plain JSON replies are still valid. Table references are restored
 * before any caller sees the response, including exact original data URLs. */
export function parseResponse(raw:string):unknown{
 const value:unknown=JSON.parse(raw);
 if(!record(value)||value.format!==format){if(record(value)&&typeof value.format==='string'&&value.format.startsWith('fpcad-response-images/'))throw Error('INVALID_RESPONSE');return value;}
 const images=value.images,response=value.response;
 if(Object.keys(value).length!==3||!Array.isArray(images)||!images.length||images.some(image=>typeof image!=='string'||image.length<minimumImageLength||!embeddedImage.test(image))||!record(response)||response.ok!==true||!record(response.data)||!record(response.data.project))throw Error('INVALID_RESPONSE');
 const used=new Set<number>();let references=0;
 const restored=mapImages(response,text=>{
  if(!text.startsWith(imagePrefix))return text;
  const suffix=text.slice(imagePrefix.length);if(!/^(0|[1-9]\d*)$/.test(suffix))throw Error('INVALID_RESPONSE');
  const index=Number(suffix);if(!Number.isSafeInteger(index)||index>=images.length)throw Error('INVALID_RESPONSE');
  used.add(index);references++;return images[index] as string;
 });
 if(used.size!==images.length||references<=images.length)throw Error('INVALID_RESPONSE');
 return restored;
}

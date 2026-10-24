const images=new Map<string,{url:string;users:number}>();

/** Keep full-resolution pixels without copying a multi-megabyte data URL into
 * every SVG attribute. Entries live only as long as their mounted consumers. */
export function acquireImageUrl(source:string){
 if(source.length<65536||!/^data:image\/(png|jpeg|webp);base64,/.test(source)||typeof URL.createObjectURL!=='function')return {url:source,release:()=>{}};
 let entry=images.get(source);
 if(!entry){
  const separator=source.indexOf(','),binary=atob(source.slice(separator+1)),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  entry={url:URL.createObjectURL(new Blob([bytes],{type:source.slice(5,source.indexOf(';'))})),users:0};images.set(source,entry);
 }
 entry.users++;let released=false;
 return {url:entry.url,release:()=>{if(released)return;released=true;if(--entry.users===0){images.delete(source);URL.revokeObjectURL(entry.url);}}};
}

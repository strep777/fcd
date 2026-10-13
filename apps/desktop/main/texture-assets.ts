import UPNG from '@pdf-lib/upng';
import {randomUUID} from 'node:crypto';
import {inspectImage,orientPixels} from '../../../packages/reference/image-input';
import {textureSchema} from '../../../packages/schema/index';
import {DomainError,hash} from './repository';
const codec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG;
export function factorColor(byte:number,factor:number){const s=byte/255,linear=s<=.04045?s/12.92:((s+.055)/1.055)**2.4,value=linear*factor;return Math.round(255*(value<=.0031308?12.92*value:1.055*value**(1/2.4)-.055));}
const uri=(b:ArrayBuffer)=>'data:image/png;base64,'+Buffer.from(b).toString('base64');
export async function textureAsset(bytes:Uint8Array,name:string,factor:number[]){
 let input;try{input=inspectImage(bytes);}catch(e){throw new DomainError((e as Error).message);}if(Math.max(input.width,input.height)>2048)throw new DomainError('TEXTURE_LIMIT');
 let png=input.bytes;if(input.mime!=='image/png'){const {nativeImage}=await import('electron');const image=nativeImage.createFromBuffer(Buffer.from(input.bytes));if(image.isEmpty())throw new DomainError('IMAGE_DECODE');png=image.toPNG();}
 const decoded=codec.decode(Uint8Array.from(png).buffer),oriented=orientPixels(new Uint8Array(codec.toRGBA8(decoded)[0]),input.width,input.height,input.orientation),{width,height}=oriented,rgba=oriented.pixels;
 for(let i=0;i<rgba.length;i++)rgba[i]=i%4===3?255:factorColor(rgba[i],factor[i%4]);
 const original=codec.encode([rgba.buffer as ArrayBuffer],width,height,0),ratio=Math.min(1,512/Math.max(width,height)),w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio)),small=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=Math.min(width-1,Math.floor((x+.5)*width/w)),sy=Math.min(height-1,Math.floor((y+.5)*height/h));small.set(rgba.subarray((sy*width+sx)*4,(sy*width+sx)*4+4),(y*w+x)*4);}
 return textureSchema.parse({id:randomUUID(),name:name.slice(0,120),width,height,png:uri(original),sha256:hash(Buffer.from(original)),proxy:{width:w,height:h,png:uri(codec.encode([small.buffer],w,h,0))}});
}

import {createCanvas,ImageData,loadImage,type Canvas} from '@napi-rs/canvas';
import UPNG from '@pdf-lib/upng';
const codec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG;
/** Synchronous raster operations used by geometry workers and reference imports. */
class RasterImage{
 constructor(private canvas:Canvas){}
 isEmpty(){return !this.canvas.width||!this.canvas.height;}
 getSize(){return {width:this.canvas.width,height:this.canvas.height};}
 toPNG(){return this.canvas.toBuffer('image/png');}
 resize({width,height}:{width:number;height:number;quality?:string}){
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(this.canvas,0,0,width,height);return new RasterImage(canvas);
 }
 crop({x,y,width,height}:{x:number;y:number;width:number;height:number}){const canvas=createCanvas(width,height);canvas.getContext('2d').drawImage(this.canvas,x,y,width,height,0,0,width,height);return new RasterImage(canvas);}
}
export const rasterImage={
 createFromBuffer(bytes:Buffer){const decoded=codec.decode(Uint8Array.from(bytes).buffer),canvas=createCanvas(decoded.width,decoded.height);canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(codec.toRGBA8(decoded)[0]),decoded.width,decoded.height),0,0);return new RasterImage(canvas);},
 async decode(bytes:Buffer){const image=await loadImage(bytes);if(!image.width||!image.height)throw Error('IMAGE_DECODE');const canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);return new RasterImage(canvas);},
 createFromDataURL(uri:string){if(!uri.startsWith('data:image/png;base64,'))throw Error('IMAGE_DECODE');return this.createFromBuffer(Buffer.from(uri.slice(22),'base64'));}
};

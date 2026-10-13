import { Resvg,initWasm } from '@resvg/resvg-wasm';
import type { Project,Geometry } from '../../../packages/schema/index';
import { svgExport } from './export';
import { exportFont,exportWasm } from './export-assets';
import { DomainError } from './repository';
let initialized:Promise<void>|undefined;
function chunk(type:string,data:Buffer){const name=Buffer.from(type),body=Buffer.concat([name,data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);body.copy(result,4);result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);return result;}
/** Preview only: explicit 144 DPI plus physical scale metadata, never silently resized. */
export async function pngExport(project:Project,geometry:Geometry[],ack:string[],nested=false){
 const dpi=144,svg=svgExport(project,geometry,ack,nested),dimensions=svg.match(/width="([\d.e+-]+)mm" height="([\d.e+-]+)mm"/)!;
 const width=Math.ceil(Number(dimensions[1])*dpi/25.4),height=Math.ceil(Number(dimensions[2])*dpi/25.4);
 if(width>16384||height>16384||width*height>24_000_000)throw new DomainError('RESOURCE_LIMIT');
 await (initialized??=exportWasm().then(bytes=>initWasm(bytes)).catch(error=>{initialized=undefined;throw error;}));
 const renderer=new Resvg(svg.replace('FurryPattern CAD · revision','PREVIEW 144 DPI · FurryPattern CAD · revision'),{dpi,background:'white',font:{fontBuffers:[await exportFont()],defaultFontFamily:'FurryPattern Sans SC',sansSerifFamily:'FurryPattern Sans SC'}});
 try{const rendered=renderer.render();try{
  const png=Buffer.from(rendered.asPng()),physical=Buffer.alloc(9);physical.writeUInt32BE(Math.round(dpi/0.0254),0);physical.writeUInt32BE(Math.round(dpi/0.0254),4);physical[8]=1;
  const text=Buffer.from(`Description\0Preview only; ${dpi} DPI; mm; revision ${project.revision}; print calibration must be checked.`,'latin1');
  return Buffer.concat([png.subarray(0,33),chunk('pHYs',physical),chunk('tEXt',text),png.subarray(33)]);
 }finally{rendered.free();}}finally{renderer.free();}
}

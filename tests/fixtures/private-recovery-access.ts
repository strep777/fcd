// Intended destination: tests/fixtures/private-recovery-access.ts.
// Tests only: expose the current formal private predicates without changing
// production exports. This is a correctness seam, not a full network runner.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {build,transform} from 'esbuild';
import {contourPolyline} from '../../packages/reference/recover-contour';
import {boxIndex} from '../../packages/surface/spatial';
import type {Piece,Point} from '../../packages/schema/index';

type SpanPredicate=(a:Point[],b:Point[],pixel:number,spacing:number,margin:number,limit:number)=>boolean;
type SpanMetric=(a:Point[],b:Point[],pixel:number,spacing?:number)=>number;
let spanModule:Promise<{spansWithin:SpanPredicate;spanError:SpanMetric;sourceSHA:string}>|undefined;
export function formalSpanPredicates(){
 return spanModule??=(async()=>{
  const file=fileURLToPath(new URL('../../packages/reference/recover-contour.ts',import.meta.url)),source=await readFile(file,'utf8');
  if(!source.includes('function spansWithin(')||!source.includes('function spanError('))throw Error('PRIVATE_SPAN_TEST_SEAM_CHANGED');
  const compiled=await build({stdin:{contents:source+'\nexport {spansWithin,spanError};',resolveDir:dirname(file),loader:'ts',sourcefile:file},bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent'});
  // A plain CommonJS evaluation also works inside Vitest's VM. Dynamic import
  // from a Function constructor there has no host import callback.
  const loaded={exports:{} as {spansWithin:SpanPredicate;spanError:SpanMetric}};
  new Function('module','exports','require',compiled.outputFiles![0].text)(loaded,loaded.exports,createRequire(file));
  if(typeof loaded.exports.spansWithin!=='function'||typeof loaded.exports.spanError!=='function')throw Error('PRIVATE_SPAN_EXPORTS_MISSING');
  return {...loaded.exports,sourceSHA:createHash('sha256').update(source).digest('hex')};
 })();
}

type Curve=NonNullable<Piece['curves']>[number];
export type ProbeChain={raw:Point[];closed:boolean;anchors:string[];nodes:Point[];curves:Curve[];raster?:{nodes:Point[];curves:Curve[]}};
type Probe={check:()=>Map<number,Point[]>};
type Factory=(chains:ProbeChain[],createId:()=>string,g:number,onPair:(i:number,j:number)=>void,onOverflow:()=>void)=>Probe;
let crossingFactory:Promise<{factory:Factory;sourceSHA:string}>|undefined;
export function formalCrossingFactory(){
 return crossingFactory??=(async()=>{
  const source=await readFile(new URL('../../packages/reference/shared-contour.ts',import.meta.url),'utf8'),start=source.indexOf(' // Geometry arrays are replaced, never edited'),end=source.indexOf(' const proposed=',start);
  if(start<0||end<0)throw Error('PRIVATE_CROSSING_TEST_SEAM_CHANGED');
  let body=source.slice(start,end);
  for(const [marker,append]of [['for(const [i,j] of pairs()){','onPair(i,j);'],['if(relevant.length>1000000){','onOverflow();']]){
   if(body.split(marker).length!==2)throw Error('PRIVATE_PAIR_OBSERVATION_SEAM_CHANGED');body=body.replace(marker,marker+append);
  }
  const text=`function factory(chains:any[],createId:()=>string,g:number,onPair:(i:number,j:number)=>void,onOverflow:()=>void){const key=(p:any)=>\`\${Math.round(p.xMm/g*1e8)}:\${Math.round(p.yMm/g*1e8)}\`;${body}\nreturn{check:crossingChains};}`;
  const compiled=await transform(text,{loader:'ts',target:'es2022'});
  const factory=new Function('contourPolyline','boxIndex',compiled.code+'\nreturn factory;')(contourPolyline,boxIndex) as Factory;
  return {factory,sourceSHA:createHash('sha256').update(source).digest('hex')};
 })();
}

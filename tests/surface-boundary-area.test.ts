import {expect,it} from 'vitest';
import type {SurfaceReport} from '../packages/schema/index';
import {simplifyReportBoundary} from '../packages/surface/planar';

const report=(xy:number[][]):SurfaceReport=>({faceIds:['face'],uv:xy.map(([xMm,yMm],i)=>({vertexId:String(i),xMm,yMm})),boundary:xy.map((_,i)=>String(i)),areaErrorMax:0,edgeErrorMax:0,distortionMean:0,distortionP95:0,distortionMax:0,faceDistortion:[],status:'acceptable'});
it('retains the real two-face thin material boundary when a close chord loses half its area',()=>{
 const xy=[[0,0],[2.442000998703663,1.7635293793168336],[-.000017116094245841935,.000011086221385424287],[-3.157242820374079,-2.280027489810121]];
 for(const points of [xy,[...xy].reverse(),xy.map(([x,y])=>[x+1000,y-2000])]){
  const original=report(points),result=simplifyReportBoundary(original);
  expect(result.boundary).toEqual(original.boundary);
  expect(result.uv).toEqual(original.uv);
 }
});
it('still removes exactly redundant collinear stations without changing the physical boundary',()=>{
 const original=report([[0,0],[5,0],[10,0],[10,10],[0,10]]),result=simplifyReportBoundary(original);
 expect(result.boundary).toHaveLength(4);
 expect(result.boundary).not.toContain('1');
 expect(result.uv).toEqual(original.uv);
});

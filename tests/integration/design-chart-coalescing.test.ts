import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Surface} from '../../packages/schema/index';
import {projectedReport} from '../../packages/surface/projected-report';
import {mergeDesignCharts} from '../../packages/surface/merge-design-charts';
import {openDesignSeams} from '../../packages/surface/design-cuts';

function panel():Surface{
 const vertices=Array.from({length:6},(_,i)=>({id:'v'+i,xMm:i%3*50,yMm:Math.floor(i/3)*60,zMm:0}));
 return {id:'panel',source:'obj',topologyVersion:1,vertices,faces:[[0,1,4],[0,4,3],[1,2,5],[1,5,4]].map((v,i)=>({id:'f'+i,region:'material:blue',vertices:v.map(i=>'v'+i) as [string,string,string]}))};
}
const charts=(mesh:Surface)=>mesh.faces.map(f=>projectedReport({...mesh,faces:[f]})!);
it('removes needless sewing divisions without moving physical geometry or changing coverage',async()=>{
 const mesh=panel(),before=structuredClone(mesh),reports=charts(mesh),original=structuredClone(reports);
 const merged=await mergeDesignCharts(mesh,reports,async faces=>projectedReport({...mesh,faces}));
 expect(merged).toHaveLength(1);expect(merged[0].faceIds.sort()).toEqual(mesh.faces.map(f=>f.id));
 expect(merged[0].areaErrorMax).toBeLessThan(1e-12);expect(merged[0].edgeErrorMax).toBeLessThan(1e-12);
 expect(mesh).toEqual(before);expect(reports).toEqual(original);
});
it.each(['material','user seam'] as const)('retains a physical %s interface despite both sides being flat',async kind=>{
 let mesh=panel();if(kind==='material')mesh.faces.slice(2).forEach(f=>f.region='material:yellow');
 else mesh=openDesignSeams({...mesh,cutConstraints:[{a:'v1',b:'v4',locked:true}]},randomUUID);
 const merged=await mergeDesignCharts(mesh,charts(mesh),async faces=>projectedReport({...mesh,faces}));
 expect(merged).toHaveLength(2);expect(merged.map(r=>r.faceIds.length).sort()).toEqual([2,2]);
});
it('keeps successful panels unchanged when a proposed union violates physical stretch',async()=>{
 const mesh=panel(),input=charts(mesh),before=structuredClone(input);
 const merged=await mergeDesignCharts(mesh,input,async faces=>({...projectedReport({...mesh,faces})!,edgeErrorMax:.101}));
 expect(merged).toEqual(before);expect(input).toEqual(before);
});

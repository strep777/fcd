import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Surface} from '../packages/schema/index';
import {projectedReport} from '../packages/surface/projected-report';
import {designQualityFailure} from '../packages/surface/design-partition';
const mesh=(z=0):Surface=>{const vertices=[[0,0,0],[20,0,0],[20,.0001,0],[20.00006,.00006,z]].map(([xMm,yMm,zMm])=>({id:randomUUID(),xMm,yMm,zMm}));return {id:randomUUID(),topologyVersion:1,source:'obj',vertices,faces:[[0,1,2],[1,3,2]].map(ids=>({id:randomUUID(),region:'panel',vertices:ids.map(i=>vertices[i].id) as [string,string,string]}))};};
it('retains a measurable chart containing a well-conditioned tiny triangle',()=>{
 for(const z of [0,1e-5]){const input=mesh(z),before=structuredClone(input),report=projectedReport(input);expect(input).toEqual(before);expect(report).toBeDefined();expect(report!.faceIds).toHaveLength(2);expect(designQualityFailure(report!)).toBe(false);}
});
it('rejects unresolved or oppositely oriented triangles regardless of their size',()=>{
 const reverse=mesh();reverse.faces[1].vertices.reverse();expect(projectedReport(reverse)).toBeUndefined();const collapsed=mesh();collapsed.vertices[3].xMm=20;expect(projectedReport(collapsed)).toBeUndefined();
});

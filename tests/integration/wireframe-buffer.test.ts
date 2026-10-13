import {it,expect} from 'vitest';
import {surfaceWireVertices} from '../../packages/surface/rendering';
import {gridMesh} from '../large-mesh-fixture';
it('wireframe shares triangle edges and stores only centred positions without changing geometry',()=>{
 const mesh=gridMesh(1,1),before=JSON.stringify(mesh),vertices=surfaceWireVertices(mesh,{cx:5,cy:5,cz:0});
 expect(vertices).toBeInstanceOf(Float32Array);expect(vertices.length).toBe(5*2*3);expect([...vertices]).toContain(-5);expect([...vertices]).toContain(5);expect(JSON.stringify(mesh)).toBe(before);
});
it('200000 face imported mesh preserves every unique wire edge with a bounded buffer',()=>{
 const mesh=gridMesh(400,250),vertices=surfaceWireVertices(mesh,{cx:0,cy:0,cz:0}),edges=400*251+250*401+400*250;
 expect(vertices.length).toBe(edges*6);expect(vertices.byteLength).toBeLessThan(mesh.faces.length*18*4);
});

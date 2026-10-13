import {it,expect} from 'vitest';
import {numericalTriangleArea} from '../packages/surface/numerical';
import {parseObj,validateSurface} from '../apps/desktop/main/surface';
import fixture from './fixtures/material-numerical-validity.json';
it('matches native classification of all actual material ears: 21 good shapes and one unreliable needle',()=>{
 expect(fixture).toHaveLength(22);for(const row of fixture)expect(numericalTriangleArea(row.points as [number,number,number][])!==undefined).toBe(row.valid);expect(fixture.filter(r=>r.valid)).toHaveLength(21);
});
it('accepts scaled and translated well-shaped OBJ triangles, retaining all topology',()=>{
 for(const scale of [1e-6,.001,1,1000])for(const offset of [0,1000]){const s=parseObj(`v ${offset} ${offset} 0\nv ${offset+scale} ${offset} 0\nv ${offset} ${offset+scale} 0\nf 1 2 3`),before=structuredClone(s);expect(()=>validateSurface(s)).not.toThrow();expect(s).toEqual(before);}
});
it('rejects zero-area and unresolved needles, without turning numerical validity into a size cutoff',()=>{
 expect(()=>parseObj('v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3')).toThrow('DEGENERATE_MESH');const bad=fixture.find(r=>!r.valid)!;expect(()=>parseObj(bad.points.map(p=>'v '+p.join(' ')).join('\n')+'\nf 1 2 3')).toThrow('DEGENERATE_MESH');expect(numericalTriangleArea([[NaN,0,0],[1,0,0],[0,1,0]])).toBeUndefined();
});

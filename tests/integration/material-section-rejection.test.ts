import {it,expect} from 'vitest';
import {refineMaterialProvenance,type MaterialFace} from '../../packages/surface/design-cuts';
import type {Child} from '../../packages/surface/refine';
it('rejects an unsafe optional section without partially replacing provenance',()=>{
 const source:MaterialFace={faceId:'original',color:'#ffffff',barycentric:[[1,0,0],[0,1,0],[0,0,1]]},map=new Map([['parent',source]]),before=structuredClone(map);
 const child=(id:string,triangle:Child['triangle']):Child=>({face:{id,vertices:['a','b','c'],region:'body'},triangle});
 const valid=child('valid',[[0,0],[500,0],[0,500]]),invalid=child('outside',[[-1e-7,0],[500,0],[0,500]]);
 expect(refineMaterialProvenance(map,new Map([['parent',[valid,invalid]]]))).toBeUndefined();expect(map).toEqual(before);
 const accepted=refineMaterialProvenance(map,new Map([['parent',[valid]]]));expect(accepted?.has('parent')).toBe(false);expect(accepted?.get('valid')?.faceId).toBe('original');expect(map).toEqual(before);
 expect(()=>refineMaterialProvenance(map,new Map([['missing',[valid]]]))).toThrow('STALE_BINDING');
});

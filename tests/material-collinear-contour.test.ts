import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import type {Surface,Marking} from '../packages/schema/index';
import fixture from './fixtures/material-collinear-edge-crack.json';
import {prepareDesignSurface} from '../apps/desktop/main/design-cuts';
import {project} from './fixtures';
it('removes zero-area straight contour stations before they create cracks along a shared model edge',async()=>{
 const p=project();p.pieces=[];p.surface=fixture.surface as Surface;p.markings=fixture.markings as unknown as Marking[];const before=structuredClone(p),w=await prepareDesignSurface(resolve('target/release/fpcad-worker.exe'),p,true,false),source=new Map(p.surface.faces.map(f=>[f.id,f])),edges=new Map<string,{original:string;shared:boolean}[]>();
 for(const face of w.surface.faces){const m=w.provenance.get(face.id)!,f=source.get(m.faceId)!;face.vertices.forEach((a,i)=>{const b=face.vertices[(i+1)%3],first=m.barycentric[i],second=m.barycentric[(i+1)%3],zero=first.findIndex((n,j)=>n===0&&second[j]===0),pair=zero<0?[]:f.vertices.filter((_,j)=>j!==zero),key=[a,b].sort().join('|'),rows=edges.get(key)??[];rows.push({original:m.faceId,shared:fixture.chosen.edge.every(id=>pair.includes(id))});edges.set(key,rows);});}
 expect(p).toEqual(before);expect([...edges.values()].filter(rows=>rows.length===1&&rows[0].shared)).toHaveLength(0);expect(('canonicalization' in w?w.canonicalization:undefined)!.maxShiftMm).toBeLessThanOrEqual(1e-6);expect(('canonicalization' in w?w.canonicalization:undefined)!.perColor.every(c=>Math.abs(c.errorMm2)<1e-6)).toBe(true);
});

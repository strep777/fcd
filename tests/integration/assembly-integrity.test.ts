import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {parseObj,unwrapSurface} from '../../apps/desktop/main/surface';
import {assemblyIntegrity} from '../../packages/surface/assembly-integrity';
import {assemblyAvailability} from '../../packages/surface/cut-assembly';
it('historical previews reject hash-stale shapes and surfaces even when IDs and topology still match',async()=>{
 const surface=parseObj('v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf 1 2 3\nf 1 3 4'),run=await unwrapSurface(resolve('target/release/fpcad-worker.exe'),surface,{...project(),pieces:[]});
 expect(await assemblyIntegrity(surface,run)).toBe(true);
 const changed=structuredClone(run);changed.pieces[0].nodes[0].xMm+=1;
 expect(assemblyAvailability(surface,changed).stale).toEqual([]);
 expect(await assemblyIntegrity(surface,changed)).toBe(false);
 const moved=structuredClone(surface);moved.vertices[0].xMm+=1;
 expect(assemblyAvailability(moved,run).stale).toEqual([]);
 expect(await assemblyIntegrity(moved,run)).toBe(false);
 const binding=structuredClone(run);binding.bindings[0].surfaceHash='0'.repeat(64);expect(await assemblyIntegrity(surface,binding)).toBe(false);
 const colored=structuredClone(run);colored.pieces[0].color='#ff1122';expect(await assemblyIntegrity(surface,colored)).toBe(true);
});

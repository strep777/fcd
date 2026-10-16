import {it,expect} from 'vitest';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {gridMesh} from '../large-mesh-fixture';
import {textureAsset} from '../../apps/desktop/main/texture-assets';
import {exportGlb,parseGlb} from '../../apps/desktop/main/glb';
import UPNG from '@pdf-lib/upng';
it('retains every triangle and UV when exporting a large single texture group',async()=>{
 const codec=(UPNG as unknown as {default?:typeof UPNG}).default??UPNG,mesh=gridMesh(125,200),rgba=new Uint8Array([255,0,0,255]);
 const texture=await textureAsset(new Uint8Array(codec.encode([rgba.buffer],1,1,0)),'red',[1,1,1,1]);
 mesh.textures=[texture];const vertices=new Map(mesh.vertices.map(v=>[v.id,v]));mesh.faces.forEach(f=>f.region='textured-grid');
 mesh.textureFaces=mesh.faces.map(f=>({faceId:f.id,textureId:texture.id,uv:f.vertices.map(id=>{const v=vertices.get(id)!;return [v.xMm/1250,v.yMm/2000] as [number,number];}) as [[number,number],[number,number],[number,number]]}));
 const start=performance.now(),bytes=await exportGlb(mesh),exportMs=performance.now()-start,restored=await parseGlb(bytes);
 expect(restored.faces).toHaveLength(50000);expect(restored.vertices).toHaveLength(mesh.vertices.length);expect(restored.textureFaces).toHaveLength(50000);expect(restored.faces.every(f=>f.region==='textured-grid')).toBe(true);
 console.log('Large textured GLB export ms:',exportMs.toFixed(1));writeFileSync('test-results/large-export.json',JSON.stringify({faces:50000,exportMs,bytes:bytes.length},null,2));
},30000);

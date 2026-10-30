import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {importedGarment} from '../fixtures/imported-garment';
import {surfaceMarking} from '../../apps/desktop/main/markings';
import {editSurfaceMarking} from '../../apps/desktop/main/surface-marking-edit';
import {previewFragments} from '../../packages/surface/marking-preview';
import {surfaceFramePoint} from '../../packages/surface/edit-surface-point';
import {projectionFaces} from '../../packages/surface/projection-scope';
import {garmentAnatomy,createPlacementMembership,placementRegion} from '../../packages/surface/garment-anatomy';
import {translateShape,transformShape,type Shape} from '../../packages/surface/attached-edit';
import {transportSurfaceShape} from '../../packages/surface/transport-decal';

const worker=resolve('target/release/fpcad-worker.exe');
const area=(rings:number[][][])=>rings.reduce((sum,r)=>sum+r.reduce((n,a,i)=>{const b=r[(i+1)%r.length];return n+a[1]*b[2]-b[1]*a[2];},0)/2,0);
it.each([{}, {reverseDiagonal:true}, {subdivisions:2}])('edited anatomical scope clips the same physical region in preview and native save (%j)',async options=>{
 const p=project();p.pieces=[];p.surface=importedGarment('PatternBody',options);const frame=garmentAnatomy(p.surface)!;
 const x=frame.neck[0]+frame.halfWidth*1.04,shape:Shape={regions:['garment:arm-left'],origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[{xMm:x-30,yMm:1000},{xMm:x+100,yMm:1000},{xMm:x+100,yMm:1100},{xMm:x-30,yMm:1100}]};
 const initial=await surfaceMarking(worker,p,shape,'#2277ee','arm');p.markings=[initial];const before=JSON.stringify(p);
 const edited=translateShape(transformShape(shape,.96,1.02,.08),-5,0),preview=previewFragments(p.surface,edited)!,saved=await editSurfaceMarking(worker,p,initial.id,edited),matches=createPlacementMembership(p.surface,shape.regions!),faces=new Map(p.surface.faces.map(f=>[f.id,f]));
 expect(preview.length).toBeGreaterThan(0);expect(saved.fragments.length).toBeGreaterThan(0);expect(saved.surfaceShape?.regions).toEqual(['garment:arm-left']);
 for(const fragments of [preview,saved.fragments])for(const f of fragments)expect(matches(faces.get(f.faceId)!,f.rings)).toBe(true);
 const previewAreas=new Map(preview.map(f=>[f.faceId,area(f.rings)])),savedAreas=new Map(saved.fragments.map(f=>[f.faceId,area(f.rings)]));
 for(const id of new Set([...previewAreas.keys(),...savedAreas.keys()]))expect(previewAreas.get(id)??0).toBeCloseTo(savedAreas.get(id)??0,7);
 const resolvePoint=surfaceFramePoint(p.surface,shape,shape.regions,projectionFaces(p.surface,shape));expect(resolvePoint({xMm:x+20,yMm:1050})?.zMm).toBe(100);expect(resolvePoint({xMm:x-20,yMm:1050})).toBeUndefined();
 expect(JSON.stringify(p)).toBe(before);
});

it('an unknown part stays empty and cannot silently become unrestricted',async()=>{
 const p=project();p.pieces=[];p.surface=importedGarment();const shape:Shape={regions:['garment:missing'],origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[{xMm:-20,yMm:1000},{xMm:20,yMm:1000},{xMm:20,yMm:1100},{xMm:-20,yMm:1100}]};
 expect(previewFragments(p.surface,shape)).toEqual([]);await expect(surfaceMarking(worker,p,shape,'#2277ee','missing')).rejects.toThrow('NO_VISIBLE_PROJECTION');
});

it('physical pointer targets preserve anatomical scope within a part and change it only across the actual boundary',()=>{
 const surface=importedGarment(),frame=garmentAnatomy(surface)!,x=frame.neck[0]+frame.halfWidth*1.04,face=surface.faces.find(f=>f.vertices.some(id=>surface.vertices.find(v=>v.id===id)!.xMm===600))!,point={xMm:x+20,yMm:1050,zMm:100},shape:Shape={regions:['garment:arm-left'],origin:[x+20,1050,100],axes:[[1,0,0],[0,1,0],[0,0,1]],nodes:[{xMm:0,yMm:0},{xMm:20,yMm:0},{xMm:0,yMm:20}]};
 const within={...point,xMm:x+21},across={...point,xMm:x-1};
 expect(transportSurfaceShape(shape,point,[0,0,1],within,[0,0,1],placementRegion(surface,face,within),face.id).regions).toEqual(['garment:arm-left']);
 expect(transportSurfaceShape(shape,point,[0,0,1],across,[0,0,1],placementRegion(surface,face,across),face.id).regions).toEqual(['garment:body']);
 expect(placementRegion(surface,face,{xMm:x+1,yMm:frame.hipY-1})).toBe('garment:leg-left');
});

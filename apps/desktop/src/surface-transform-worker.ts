import type {Surface} from '../../../packages/schema/index';
import type {Shape} from '../../../packages/surface/attached-edit';
import {shapeWorld} from '../../../packages/surface/attached-edit';
import {previewFragments} from '../../../packages/surface/marking-preview';
import {markingSurfaceOutline} from '../../../packages/surface/marking-outline';
import {surfaceFramePoint} from '../../../packages/surface/edit-surface-point';
import {projectionFaces} from '../../../packages/surface/projection-scope';
import {transformFrame} from '../../../packages/surface/free-transform';
import {decalChart} from '../../../packages/surface/decal-chart';

let surface:Surface|undefined;
self.onmessage=({data}:{data:{surface?:Surface;token:number;shape:Shape;angleRad:number}})=>{
 if(data.surface)surface=data.surface;
 try{
  if(!surface)throw Error('MODEL_REQUIRED');
  const chart=decalChart(surface,data.shape),scope=projectionFaces(surface,data.shape,true,chart);
  const fragments=previewFragments(surface,data.shape,2000000,{chart,scope});
  if(!fragments)throw Error('PROJECTION_LIMIT');
  const outline=markingSurfaceOutline(surface,{surfaceId:surface.id,topologyVersion:surface.topologyVersion,fragments});
  const resolve=surfaceFramePoint(surface,data.shape,data.shape.regions,scope,chart);
  const handles=transformFrame(data.shape,data.angleRad).handles.map(h=>({...h,world:h.id==='rotate'?shapeWorld(data.shape,h.point):resolve(h.point)??shapeWorld(data.shape,h.point)}));
  self.postMessage({token:data.token,fragments,outline,handles});
 }catch(error){self.postMessage({token:data.token,error:(error as Error).message});}
};

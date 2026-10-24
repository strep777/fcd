import assert from 'node:assert/strict';
import {surfaceCoordinates} from '../ui-navigation.mjs';

// Observe the actual Canvas 2D draw calls. This works with production Vue builds
// and does not add a product test API or read private component state.
export function installCutRenderObserver(){
 const prototype=CanvasRenderingContext2D.prototype;
 if(prototype.__cutRenderObserver)return;
 Object.defineProperty(prototype,'__cutRenderObserver',{value:true});
 const paths=new WeakMap(),frames=new WeakMap(),originals={};
 for(const name of ['fillRect','beginPath','moveTo','lineTo','closePath','arc','stroke','fill'])originals[name]=prototype[name];
 const surface=context=>context.canvas.matches('.surface-view');
 prototype.fillRect=function(...args){if(surface(this))frames.set(this.canvas,{segments:[],handles:[]});return originals.fillRect.apply(this,args);};
 prototype.beginPath=function(...args){if(surface(this))paths.set(this,[]);return originals.beginPath.apply(this,args);};
 for(const name of ['moveTo','lineTo','closePath','arc'])prototype[name]=function(...args){if(surface(this))paths.get(this)?.push({name,args});return originals[name].apply(this,args);};
 prototype.stroke=function(...args){const path=paths.get(this),frame=frames.get(this.canvas);if(surface(this)&&!args.length&&this.lineWidth===2&&path?.length===2&&path[0].name==='moveTo'&&path[1].name==='lineTo')frame?.segments.push({a:{x:path[0].args[0],y:path[0].args[1]},b:{x:path[1].args[0],y:path[1].args[1]},color:this.strokeStyle});return originals.stroke.apply(this,args);};
 prototype.fill=function(...args){const path=paths.get(this),frame=frames.get(this.canvas);if(surface(this)&&!args.length&&path?.length===1&&path[0].name==='arc'&&path[0].args[2]===5)frame?.handles.push({x:path[0].args[0],y:path[0].args[1]});return originals.fill.apply(this,args);};
 window.cutRenderObservation=()=>{const canvas=document.querySelector('canvas.surface-view');if(!canvas)throw Error('Cut path oracle requires the visible Canvas 2D renderer');const frame=frames.get(canvas);if(!frame)throw Error('Surface has not painted');const normalize=document.createElement('canvas').getContext('2d'),color=token=>{normalize.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue(token).trim();return normalize.strokeStyle;};return {...frame,accent:color('--accent'),teal:color('--studio-teal')};};
}

export async function cutRenderFrame(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return page.evaluate(()=>window.cutRenderObservation());}
export async function cutHandle(page,index){const frame=await cutRenderFrame(page);assert(frame.handles[index],`Missing visible pen handle ${index}`);return surfaceCoordinates(page,frame.handles[index].x,frame.handles[index].y);}
export function cutFrontCalibration(frame,controlPoints){const a=controlPoints[0],b=controlPoints.at(-1),first=frame.handles[0],last=frame.handles.at(-1),scale=(first.y-last.y)/(b.yMm-a.yMm);assert(Number.isFinite(scale)&&scale>0);return {scale,x:first.x-a.xMm*scale,y:first.y+a.yMm*scale};}
export function cutDraftWorld(frame,calibration={scale:2.25,x:0,y:225}){const point=p=>({xMm:(p.x-calibration.x)/calibration.scale,yMm:(calibration.y-p.y)/calibration.scale,zMm:0});const segments=frame.segments.filter(line=>line.color===frame.accent||line.color===frame.teal).map(line=>({a:point(line.a),b:point(line.b)}));assert(segments.length>=3,'The renderer must paint the complete closed draft');return segments;}
export function savedCutWorld(surface,lines){const vertices=new Map(surface.vertices.map(vertex=>[vertex.id,vertex]));return lines.flatMap(line=>line.edges.map(edge=>({a:vertices.get(edge.a),b:vertices.get(edge.b)})));}
export function assertClosedSavedCut(line){assert.equal(line.kind,'pen');assert.equal(line.closed,true);assert(line.controlPoints.length>=3);const degrees=new Map(),seen=new Set();for(const {a,b} of line.edges){const key=[a,b].sort().join(':');assert.notEqual(a,b);assert(!seen.has(key),'A saved cut must not retrace an edge');seen.add(key);for(const id of [a,b])degrees.set(id,(degrees.get(id)??0)+1);}assert(degrees.size>=3);assert([...degrees.values()].every(degree=>degree===2),'Every saved cut vertex has exactly two neighbors');}

// Independent full interval coverage check: subdivisions may change, but no
// stretch of the rendered world path may disappear, move, or be added on save.
export function assertSameWorldTrace(preview,saved,tolerance=1e-5){
 const xyz=point=>[point.xMm,point.yMm,point.zMm];
 function covers(source,target){for(const segment of source){const a=xyz(segment.a),b=xyz(segment.b),direction=b.map((value,index)=>value-a[index]),length=Math.hypot(...direction);if(length<=tolerance)continue;const intervals=[];for(const edge of target){const endpoints=[xyz(edge.a),xyz(edge.b)],parameters=endpoints.map(point=>point.reduce((sum,value,index)=>sum+(value-a[index])*direction[index],0)/(length*length));if(endpoints.some((point,index)=>Math.hypot(...point.map((value,axis)=>value-a[axis]-parameters[index]*direction[axis]))>tolerance))continue;intervals.push([Math.min(...parameters),Math.max(...parameters)]);}intervals.sort((a,b)=>a[0]-b[0]);let end=0;for(const [start,next] of intervals){if(start>end+tolerance/length)break;end=Math.max(end,next);}assert(end>=1-tolerance/length,'Rendered and saved cut world segments must cover exactly the same path');}}
 assert(preview.length&&saved.length);covers(preview,saved);covers(saved,preview);
 const length=segments=>segments.reduce((sum,{a,b})=>sum+Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm),0);assert(Math.abs(length(preview)-length(saved))<tolerance,'Saving must preserve the total physical length without retracing');
}

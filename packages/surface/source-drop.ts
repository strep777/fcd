import type {Piece,CutProjection,Marking} from '../schema/index';
import {pointBounds} from '../pattern/edit';
import {drawingIssue} from './drawing';
import {pieceContour,sampleShapeContour,mapShapeContour} from './shape-contour';

/** Keep the library's millimetre contour and its orientation in the current view frame. */
export function sourceSurfaceShape(source:Piece,position:{xMm:number;yMm:number;zMm:number},frame:CutProjection,anchor?:{xMm:number;yMm:number}):NonNullable<Marking['surfaceShape']>{
 if(!source.closed)throw Error('INVALID_GEOMETRY');
 const holes=source.holes??[];
 if(source.nodes.length>2000||holes.length>32||holes.some(ring=>ring.length>2000))throw Error('RESOURCE_LIMIT');
 const contour=pieceContour(source);
 if(contour.nodes.length<3||(!contour.curves?.length&&drawingIssue(contour.nodes))||holes.some(ring=>ring.length<3||drawingIssue(ring)))throw Error('INVALID_GEOMETRY');
 const bounds=pointBounds(sampleShapeContour(contour)),cx=anchor?.xMm??(bounds.minX+bounds.maxX)/2,cy=anchor?.yMm??(bounds.minY+bounds.maxY)/2;if(!Number.isFinite(cx)||!Number.isFinite(cy)||cx<bounds.minX||cx>bounds.maxX||cy<bounds.minY||cy>bounds.maxY)throw Error('INVALID_GEOMETRY');const map=(p:{xMm:number;yMm:number})=>({xMm:p.xMm-cx,yMm:p.yMm-cy});
 return {...mapShapeContour(contour,map),origin:[position.xMm,position.yMm,position.zMm],axes:frame.axes.map(axis=>[...axis]) as CutProjection['axes']};
}

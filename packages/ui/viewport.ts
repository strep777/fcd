export type ViewBox={x:number;y:number;width:number;height:number};
export type ViewCamera={zoom:number;panX:number;panY:number};
export const minimumZoom=.1,maximumZoom=32;
export function parseViewBox(value:string):ViewBox{const [x,y,width,height]=value.trim().split(/[ ,]+/).map(Number);if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)throw Error('INVALID_VIEWPORT');return {x,y,width,height};}
export function cameraBox(base:ViewBox,camera:ViewCamera):ViewBox{const zoom=Math.max(minimumZoom,Math.min(maximumZoom,camera.zoom));return {x:base.x+base.width/2+camera.panX-base.width/zoom/2,y:base.y+base.height/2+camera.panY-base.height/zoom/2,width:base.width/zoom,height:base.height/zoom};}
/** Screen magnification only. The world point beneath the cursor remains fixed. */
export function zoomCamera(base:ViewBox,camera:ViewCamera,factor:number,anchor?:{x:number;y:number}):ViewCamera{if(!Number.isFinite(factor)||factor<=0)return camera;const current=cameraBox(base,camera),zoom=Math.max(minimumZoom,Math.min(maximumZoom,camera.zoom*factor)),ratio=zoom/camera.zoom,p=anchor??{x:current.x+current.width/2,y:current.y+current.height/2};return {zoom,panX:p.x-(p.x-current.x)/ratio+current.width/ratio/2-base.x-base.width/2,panY:p.y-(p.y-current.y)/ratio+current.height/ratio/2-base.y-base.height/2};}

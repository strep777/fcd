import type{Point}from'../../packages/schema/index';
type XY = {xMm: number; yMm: number};
const point = (xMm: number, yMm: number, id: string): Point => ({xMm, yMm, id});
const palette = {A: [240, 220, 40], B: [35, 70, 220], C: [220, 40, 60]};
const width = 64, height = 64;
const junction = {xMm: 32, yMm: 32};
const sourceOwner = (x: number, y: number): keyof typeof palette =>
  x >= 35 || (x >= 32 && Math.abs(y - 32) <= 2 * (x - 32) / 3) ? 'A' : y < 32 ? 'C' : 'B';

// Independently defined analytic three-material source. The two real corners
// are sqrt(13) pixels from the junction; remote vertical sides are NOT the
// incident tip flanks. The six-square-pixel protrusion belongs to material A.

type Mode='offset3'|'noise3'|'shadow';

// Lighting/noise changes measured RGB only; analytic material membership,
// raw branch geometry, both independent opaque A cores and1.5px source bound
// are unchanged. Branch palette remains the same material representative.
function observed(color:number[],x:number,y:number,mode:Mode){return color.map(v=>mode==='shadow'?Math.round(v*(.9+.001*(x+.5-32))):v+(mode==='offset3'?3:(x+y)%2?3:-3));}

function source(mode:Mode) {
  const rgba = new Uint8Array(width * height * 4), aa = 8;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sum = [0, 0, 0];
    for (let sy = 0; sy < aa; sy++) for (let sx = 0; sx < aa; sx++) {
      const color = palette[sourceOwner(x + (sx + .5) / aa, y + (sy + .5) / aa)];
      for (let c = 0; c < 3; c++) sum[c] += color[c];
    }
    rgba.set([...sum.map(v => Math.round(v / aa ** 2)), 255], (y * width + x) * 4);
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=4*(y*width+x),rgb=observed(Array.from(rgba.slice(i,i+3)),x,y,mode);for(let k=0;k<3;k++)rgba[i+k]=rgb[k];}
  return rgba;
}
function contains(p: XY, ring: XY[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.yMm > p.yMm) !== (b.yMm > p.yMm) && p.xMm < (b.xMm - a.xMm) * (p.yMm - a.yMm) / (b.yMm - a.yMm) + a.xMm) inside = !inside;
  }
  return inside;
}
function boundaryDistance(p: XY, ring: XY[]) {
  return Math.min(...ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length], dx = b.xMm - a.xMm, dy = b.yMm - a.yMm;
    const t = Math.max(0, Math.min(1, ((p.xMm - a.xMm) * dx + (p.yMm - a.yMm) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.xMm - a.xMm - t * dx, p.yMm - a.yMm - t * dy);
  }));
}


export{point,palette,width,height,junction,sourceOwner,source,contains,boundaryDistance,observed};export type{Mode};

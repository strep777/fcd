import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {clippedWeights,surfaceMarking,triangleClip} from '../../apps/desktop/main/markings';
import {drawingIssue} from '../../packages/surface/drawing';
import {parseObj,unwrapSurface} from '../../apps/desktop/main/surface';
import {project} from '../fixtures';
import {pack,unpack} from '../../apps/desktop/main/archive';
it('clip-grid correction stays within 0.0002 mm on the reported nearly edge-on ear face',()=>{
 const triangle:[number,number][]=[[109.93130379935005,1736],[83.42944016719828,1800],[83.41197507441046,1800]],p:[number,number]=[98.6142,1763.3118],w=clippedWeights(p,triangle);
 expect(w.every(v=>v>=0&&v<=1)).toBe(true);expect(w.reduce((s,v)=>s+v,0)).toBeCloseTo(1,12);
 expect(Math.hypot(...[0,1].map(axis=>w.reduce((s,v,i)=>s+v*triangle[i][axis],0)-p[axis]))).toBeLessThan(.0002);
 expect(()=>clippedWeights([p[0]+.1,p[1]],triangle)).toThrow('PROJECTION_NUMERICAL');
});
it('drawing drafts reject crossings, repeated knots and zero-area selections while accepting a concave loop',()=>{
 const xy=(p:number[][])=>p.map(([xMm,yMm])=>({xMm,yMm}));
 expect(drawingIssue(xy([[0,0],[10,10],[0,10],[10,0]]))).toBe('DRAWING_CROSSING');
 expect(drawingIssue(xy([[0,0],[10,0],[10,0],[0,10]]))).toBeTruthy();
 expect(drawingIssue(xy([[0,0],[10,0],[20,0]]))).toBe('DRAWING_AREA');
 expect(drawingIssue(xy([[0,0],[10,0],[5,5],[10,10],[0,10]]))).toBe('');
});
it('freely placed surface copies preserve holes, physical scale and archive round-trip through an arbitrary frame',async()=>{
 const worker=resolve('target/release/fpcad-worker.exe'),p=project();p.pieces=[];p.surface=parseObj('v 0 0 0\nv 0 100 0\nv 0 100 100\nv 0 0 100\nf 1 2 3\nf 1 3 4');const run=await unwrapSurface(worker,p.surface,p);p.pieces=run.pieces;p.bindings=run.bindings;
 const nodes=[[20,20],[80,20],[80,80],[20,80]].map(([xMm,yMm])=>({xMm,yMm})),holes=[[[40,40],[40,60],[60,60],[60,40]].map(([xMm,yMm])=>({xMm,yMm}))];
 const m=await surfaceMarking(worker,p,{nodes,holes,origin:[0,0,0],axes:[[0,1,0],[0,0,1],[1,0,0]]},'#ff0000','Dropped copy');
 expect(m.paths[0].rings).toHaveLength(2);const area=m.paths[0].rings.reduce((s,r)=>s+r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a.xMm*b.yMm-b.xMm*a.yMm;},0)/2,0);expect(Math.abs(area)).toBeCloseTo(3200,2);p.markings=[m];expect(unpack(pack(p).bytes).markings?.[0].surfaceShape?.holes).toEqual(holes);
});

it('re-intersects sequential integer clipping roundoff with the exact face before barycentric mapping',()=>{
 const face:[number,number][]=[[43.08376462462694,1570],[6.8937390517118945e-15,1570],[49.74884620746168,1500]],p:[number,number]=[49.1568,1500.8327];
 expect(()=>clippedWeights(p,face)).toThrow('PROJECTION_NUMERICAL');const ring=triangleClip([p,[30.944203610696207,1546.6666666666667],[37,1558]],face);expect(ring.length).toBeGreaterThanOrEqual(3);
 for(const point of ring){const w=clippedWeights(point,face);expect(w.every(v=>v>=0&&v<=1)).toBe(true);expect(w.reduce((s,v)=>s+v,0)).toBeCloseTo(1,12);expect(Math.hypot(...[0,1].map(axis=>w.reduce((s,v,i)=>s+v*face[i][axis],0)-point[axis]))).toBeLessThan(1e-8);}
});

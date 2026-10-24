import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {assertClosedCutEdges,assertCutEdges,assertCutTraversal,assertSameCutPath,assertUserCutsValid,cutSegmentsWorld,type CutSegment} from '../../packages/surface/cut-path-contract';
import {parseObj} from '../../apps/desktop/main/surface';
import type {CutLine} from '../../packages/schema/index';

const p=(xMm:number,yMm=0,zMm=0)=>({xMm,yMm,zMm});
const segment=(a:ReturnType<typeof p>,b:ReturnType<typeof p>):CutSegment=>({a,b});
const ring=[{a:'a',b:'b'},{a:'b',b:'c'},{a:'c',b:'a'}];

it('open seam graphs accept a single chain and reject branches, duplicate traversals and disconnected rings',()=>{
 expect(()=>assertCutEdges([{a:'a',b:'b'}],false)).not.toThrow();
 expect(()=>assertCutEdges([{a:'b',b:'c'},{a:'a',b:'b'}],false)).not.toThrow();
 for(const edges of [[],ring,[{a:'a',b:'b'},{a:'b',b:'a'}],[{a:'a',b:'b'},{a:'b',b:'c'},{a:'b',b:'d'}],[{a:'a',b:'b'},{a:'c',b:'d'}],[{a:'x',b:'y'},...ring]])expect(()=>assertCutEdges(edges,false)).toThrow('CUT_PATH_INVALID');
});

it('pen traversal rejects an out-and-back trace even when its geometric coverage matches',()=>{
 const saved=[segment(p(0),p(100))],draft=[...saved,segment(p(100),p(50))];
 expect(()=>assertSameCutPath(draft,saved)).not.toThrow();
 expect(()=>assertCutTraversal(draft,saved,false)).toThrow('CUT_PATH_INVALID');
 expect(()=>assertCutTraversal([segment(p(0),p(50)),segment(p(50),p(100))],saved,false)).not.toThrow();
});

it('closed cut graph accepts subdivided rings and rejects dangling ends, branches and retraces',()=>{
 expect(()=>assertClosedCutEdges(ring)).not.toThrow();
 expect(()=>assertClosedCutEdges([{a:'a',b:'d'},{a:'d',b:'b'},...ring.slice(1)])).not.toThrow();
 expect(()=>assertClosedCutEdges([...ring,...ring.map(e=>({a:e.a+'2',b:e.b+'2'}))])).not.toThrow();
 for(const edges of [[],ring.slice(0,2),[...ring,{a:'b',b:'d'}],[...ring,{a:'b',b:'d'},{a:'d',b:'a'}],[...ring,{a:'b',b:'a'}],[...ring,{a:'a',b:'a'}]]){
  expect(()=>assertClosedCutEdges(edges)).toThrow('CUT_NOT_CLOSED');
 }
});

it('path equality permits only complete millimetre coverage with subdivisions and reversed directions',()=>{
 const draft=[segment(p(0),p(100)),segment(p(100),p(100,100)),segment(p(100,100),p(0))];
 const split=[segment(p(100),p(30)),segment(p(0),p(30)),segment(p(100,100),p(100)),segment(p(0),p(100,100))];
 expect(()=>assertSameCutPath(draft,split)).not.toThrow();
 expect(()=>assertSameCutPath(split,draft)).not.toThrow();
});

it('full interval comparison rejects tiny interior gaps that sparse point probes miss',()=>{
 const draft=[segment(p(0),p(100))],gap=[segment(p(0),p(12.345)),segment(p(12.346),p(100))];
 expect(()=>assertSameCutPath(draft,gap)).toThrow('CUT_PATH_CHANGED');
 expect(()=>assertSameCutPath(gap,draft)).toThrow('CUT_PATH_CHANGED');
});

it('bidirectional coverage rejects extra branches, overshoot and rerouted endpoints in 3D',()=>{
 const draft=[segment(p(0),p(100))];
 for(const saved of [[],[...draft,segment(p(30),p(30,1))],[segment(p(-1),p(100))],[segment(p(0),p(50,0,.1)),segment(p(50,0,.1),p(100))]]){
  expect(()=>assertSameCutPath(draft,saved)).toThrow('CUT_PATH_CHANGED');
 }
 expect(()=>assertSameCutPath([],draft)).toThrow('CUT_PATH_CHANGED');
});

it('world segments retain the exact source barycentric geometry without changing the source mesh',()=>{
 const surface=parseObj('v 10 20 30\nv 110 20 30\nv 10 220 30\nf 1 2 3'),before=structuredClone(surface);
 expect(cutSegmentsWorld(surface,[{faceId:surface.faces[0].id,a:[.5,.25,.25],b:[0,.5,.5],owner:'draft'}])).toEqual([segment(p(35,70,30),p(60,120,30))]);
 expect(()=>cutSegmentsWorld(surface,[{faceId:randomUUID(),a:[1,0,0],b:[0,1,0],owner:'draft'}])).toThrow('INVALID_CUT');
 expect(surface).toEqual(before);
});

it('generation rejects enabled broken user paths even when their stored closed flag is true',()=>{
 const surface=parseObj('v 0 0 0\nv 100 0 0\nv 0 100 0\nf 1 2 3');
 const [a,b,c]=surface.vertices.map(v=>v.id),line:CutLine={id:randomUUID(),name:'旧裁线',kind:'pen',enabled:true,closed:true,symmetric:false,controlPoints:[],tension:.5,edges:[{a,b},{a:b,b:c}]};
 surface.cutLines=[line];
 expect(()=>assertUserCutsValid(surface)).toThrow('CUT_NOT_CLOSED');
 line.edges.push({a:c,b:a});expect(()=>assertUserCutsValid(surface)).not.toThrow();
 line.closed=false;expect(()=>assertUserCutsValid(surface)).toThrow('CUT_PATH_INVALID');
 line.edges.pop();expect(()=>assertUserCutsValid(surface)).not.toThrow();
 line.enabled=false;expect(()=>assertUserCutsValid(surface)).not.toThrow();
 line.enabled=true;line.kind='midline';expect(()=>assertUserCutsValid(surface)).not.toThrow();
});

import {it,expect} from 'vitest';
import {Document,NodeIO} from '@gltf-transform/core';
import {parseGlb,exportGlb} from '../../apps/desktop/main/glb';
import {parseSvg} from '../../apps/desktop/main/svg-import';
import {svgCommands} from '../../apps/desktop/main/svg-path';
import {analyze} from '../../apps/desktop/main/worker';
import {project} from '../fixtures';
import {resolve} from 'node:path';
const worker=resolve('target/release/fpcad-worker.exe');
it('GLB bakes inherited transforms, reflects winding, welds indexed and unindexed faces and converts metres to mm',async()=>{
 const d=new Document(),buffer=d.createBuffer(),position=d.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0,.1,0,0,.1,.2,0,0,0,0,.1,.2,0,0,.2,0])).setBuffer(buffer),primitive=d.createPrimitive().setAttribute('POSITION',position),mesh=d.createMesh('panel').addPrimitive(primitive),node=d.createNode('front').setMesh(mesh).setScale([-1,1,1]),parent=d.createNode().setTranslation([1,2,3]).addChild(node);d.createScene().addChild(parent);
 const s=await parseGlb(await new NodeIO().writeBinary(d));expect(s.source).toBe('glb');expect(s.vertices).toHaveLength(4);expect(s.faces).toHaveLength(2);expect(Math.min(...s.vertices.map(v=>v.xMm))).toBeCloseTo(900,4);expect(Math.max(...s.vertices.map(v=>v.yMm))).toBeCloseTo(2200,4);expect(s.vertices.every(v=>v.zMm===3000)).toBe(true);
 const p=project();p.surface=s;const {pack,unpack}=await import('../../apps/desktop/main/archive');expect(unpack(pack(p).bytes).surface).toEqual(s);
});
it('GLB refuses unsupported topology and animated geometry without silently dropping it',async()=>{
 const d=new Document(),b=d.createBuffer(),a=d.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0,1,0,0,0,1,0])).setBuffer(b),m=d.createMesh().addPrimitive(d.createPrimitive().setAttribute('POSITION',a).setMode(1));d.createScene().addChild(d.createNode().setMesh(m));await expect(parseGlb(await new NodeIO().writeBinary(d))).rejects.toMatchObject({code:'GLB_TRIANGLES_REQUIRED'});await expect(parseGlb(new Uint8Array([1,2,3]))).rejects.toMatchObject({code:'INVALID_GLB'});
});
it('SVG physical units, group transform, evenodd holes and islands survive actual manufacturing analysis',async()=>{
 const pieces=parseSvg('<svg width="100mm" height="100mm" viewBox="0 0 100 100"><g transform="translate(10 20)"><path fill-rule="evenodd" d="M0 0H50V50H0Z M10 10H40V40H10Z M20 20H30V30H20Z"/></g></svg>');expect(pieces).toHaveLength(2);expect(pieces[0].nodes[0]).toMatchObject({xMm:10,yMm:-20});expect(pieces[0].holes).toHaveLength(1);const g=await analyze(worker,{...project(),pieces:pieces.map(p=>({...p,allowanceMm:0}))});expect(g[0].areaMm2).toBeCloseTo(1600,3);expect(g[1].areaMm2).toBeCloseTo(100,3);expect(g.flatMap(g=>g.issues).filter(i=>i.severity==='error')).toEqual([]);
});
it('SVG cubic, quadratic, smooth and relative commands retain exact control handles',()=>{
 expect(svgCommands('M0 0 Q3 3 6 0 T12 0 L12 12 0 12Z')).toContain('2 2 4 2 6 0 c');expect(svgCommands('M0 0 Q3 3 6 0 T12 0 L12 12 0 12Z')).toContain('8 -2 10 -2 12 0 c');const p=parseSvg('<svg width="100mm" height="100mm" viewBox="0 0 100 100"><path d="M0 0c5 0 5 10 10 10s5 -10 10 -10L20 20H0Z"/></svg>')[0];expect(p.curves).toHaveLength(2);expect(p.curves![0].c1).toMatchObject({xMm:5,yMm:0});
});
it('SVG default meet alignment, circles and nonzero winding use declared physical dimensions',()=>{
 const p=parseSvg('<svg width="100mm" height="50mm" viewBox="0 0 50 50"><rect width="50" height="50"/></svg>')[0];expect(p.nodes[0].xMm).toBe(25);expect(parseSvg('<svg><circle r="10"/><ellipse cx="30" rx="10" ry="5"/></svg>')).toHaveLength(2);expect(parseSvg('<svg><path d="M0 0H100V100H0Z M10 10H90V90H10Z"/></svg>')[0].holes).toEqual([]);
});
it('SVG rejects scripts, external resources, open or malformed paths, effects and ambiguous dimensions',()=>{
 for(const s of ['<svg><script/></svg>','<!DOCTYPE svg><svg/>','<svg><use href="file:///secret"/></svg>','<svg><path d="M0 0L10 10"/></svg>','<svg><path d="M0 0Lx 10Z"/></svg>','<svg width="100%"><rect width="10" height="10"/></svg>','<svg><path filter="url(#f)" d="M0 0H10V10Z"/></svg>'])expect(()=>parseSvg(s)).toThrow();
});

it('static GLB export roundtrip retains world millimetres, triangle winding and regions',async()=>{const {parseObj}=await import('../../apps/desktop/main/surface'),source=parseObj('v 0 0 0\nv 100 0 0\nv 100 200 0\nv 0 200 0\ng left\nf 1 2 3\ng right\nf 1 3 4'),round=await parseGlb(await exportGlb(source));expect(round.faces.map(f=>f.region)).toEqual(['left','right']);expect(round.vertices).toHaveLength(4);for(let i=0;i<4;i++)for(const axis of ['xMm','yMm','zMm'] as const)expect(round.vertices[i][axis]).toBeCloseTo(source.vertices[i][axis],4);});
it('imports long SVG identifiers into bounded display names without splitting Unicode characters',()=>{const p=parseSvg(`<svg><rect id="${'🐾'.repeat(80)}" width="100" height="100"/></svg>`)[0];expect(p.name.length).toBeLessThanOrEqual(120);expect(p.name.endsWith(' 1')).toBe(true);expect(Array.from(p.name).some(c=>c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff)).toBe(false);});

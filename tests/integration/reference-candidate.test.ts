import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import UPNG from '@pdf-lib/upng';
import {referenceSchema} from '../../packages/schema/index';
import {segmentReferenceCandidate} from '../../apps/desktop/main/reference-candidate';
import {referenceKey} from '../../packages/reference/resources';
import {hash} from '../../apps/desktop/main/repository';

function source(){
 const width=32,height=24,rgba=new Uint8Array(width*height*4);
 for(let y=4;y<20;y++)for(let x=4;x<20;x++)if(x<10||x>=14||y<10||y>=14)rgba.set([100,40,20,255],(y*width+x)*4);
 const png='data:image/png;base64,'+Buffer.from(UPNG.encode([rgba.buffer],width,height,0)).toString('base64');
 return referenceSchema.parse({id:randomUUID(),name:'Seeded ring',view:'front',width,height,png,calibration:{a:{x:0,y:24},b:{x:0,y:0},distanceMm:240}});
}

it('worker-safe seeded extraction retains the selected pixels, hole, physical scale and source fingerprint',()=>{
 const reference=source(),before=structuredClone(reference),run=segmentReferenceCandidate(reference,{x:6,y:6},0);
 expect(run.accepted).toBe(false);expect(run.algorithm).toBe('color-flood-1');expect(run.sourceHash).toBe(hash(referenceKey(reference)));expect(run.referenceId).toBe(reference.id);
 expect(run.pixelCount).toBe(240);expect(run.piece.color).toBe('#642814');expect(run.piece.holes).toHaveLength(1);expect(run.piece.nodes).toHaveLength(4);
 expect(Math.max(...run.piece.nodes.map(n=>n.xMm))-Math.min(...run.piece.nodes.map(n=>n.xMm))).toBe(160);
 expect(run.mask!.pixels.split('1').length-1).toBe(240);expect(reference).toEqual(before);
});

it('the worker-safe boundary preserves image-integrity and transparent-seed errors',()=>{
 const reference=source();expect(()=>segmentReferenceCandidate(reference,{x:0,y:0},0)).toThrow('TRANSPARENT_SEED');
 expect(()=>segmentReferenceCandidate({...reference,width:reference.width+1},{x:6,y:6},0)).toThrow('IMAGE_DECODE');
});

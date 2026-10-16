import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import sharp from 'sharp';
import {inferTips,sourceTipPolygon} from '../../packages/reference/image-line-corners';

type XY={xMm:number;yMm:number};

// The fixed JPEG's small white eye highlight supplied this ten-vertex ring.
// This is a crash/input fixture, not a desired reconstructed fabric boundary.
const eyeRing:XY[]=[[266,175],[270,175],[270,178],[269,178],[269,179],[265,179],[265,178],[264,178],[264,176],[266,176]].map(([xMm,yMm])=>({xMm,yMm}));
const rotate=(ring:XY[],i:number)=>[...ring.slice(i),...ring.slice(0,i)];

function rejectReusedFlanks(ring:XY[],width:number,height:number,rgba:Uint8Array){
 const points=structuredClone(ring),pixels=rgba.slice();
 // A compact loop cannot supply two independent long straight flanks. Its
 // opposite edge must not become repeated evidence for an extrapolated tip.
 const result=inferTips(ring,true,width,height,rgba);
 expect(result.candidates.filter(c=>c.accepted)).toEqual([]);
 expect(sourceTipPolygon(ring,width,height,rgba,randomUUID)).toBeUndefined();
 expect(ring).toEqual(points);expect(Buffer.from(rgba).equals(Buffer.from(pixels)),'source RGBA remains unchanged').toBe(true);
}

it.each([false,true])('the real ten-node eye loop rejects reused evidence for either winding (reversed=%s)',async reversed=>{
 const rgba=new Uint8Array(await sharp('tests/fixtures/character-front-back.jpg').extract({left:609,top:0,width:666,height:750}).ensureAlpha().raw().toBuffer());
 const ring=reversed?[...eyeRing].reverse():eyeRing;
 for(let i=0;i<ring.length;i++)rejectReusedFlanks(rotate(ring,i),666,750,rgba);
});

const rectangle=(width:number,height:number):XY[]=>[[12,12],[12+Math.floor(width/2),12],[12+width,12],[12+width,12+Math.floor(height/2)],[12+width,12+height],[12+Math.floor(width/2),12+height],[12,12+height],[12,12+Math.floor(height/2)]].map(([xMm,yMm])=>({xMm,yMm}));
it.each([{w:3,h:2},{w:9,h:9},{w:15,h:8}])('a prescribed $w by $h pixel material loop cannot borrow its opposite side as a long flank',({w,h})=>{
 const width=48,height=40,rgba=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const white=x+.5>12&&x+.5<12+w&&y+.5>12&&y+.5<12+h;rgba.set(white?[248,248,248,255]:[12,13,18,255],(y*width+x)*4);}
 const ring=rectangle(w,h);
 for(const direction of[ring,[...ring].reverse()])for(let i=0;i<ring.length;i++)rejectReusedFlanks(rotate(direction,i),width,height,rgba);
});

it.each(['coincident','zero-width']as const)('degenerate $0 loops cannot supply independent rays',kind=>{
 const ring=Array.from({length:8},(_,i)=>({xMm:16,yMm:kind==='coincident'?16:16+Math.min(i,7-i)})),rgba=new Uint8Array(32*32*4).fill(255);
 rejectReusedFlanks(ring,32,32,rgba);
});

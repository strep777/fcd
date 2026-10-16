import {it,expect} from 'vitest';import sharp from 'sharp';
import {recoverBluePigments} from '../../packages/reference/blue-pigments';
import {illustrationRegions,pigmentFamily} from '../../packages/reference/illustration';
const brightness=(color:string)=>Math.max(...[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)))/255;
it.each([['front',0,803,[[332,603],[521,603]],[[320,655],[525,655]],[648,804]],['back',803,733,[[167,604],[362,606]],[[160,670],[360,670]],[457,806]]] as const)('retains independent sharp navy thigh drops and tail band in real %s pigment sources',async(_view,left,width,drops,blue,tail)=>{
 const rgba=await sharp('tests/fixtures/character-blue-white-front-back.png').extract({left,top:0,width,height:1024}).ensureAlpha().raw().toBuffer(),r=illustrationRegions(width,1024,rgba),owner=(x:number,y:number)=>r.regions.find(a=>a.indices.includes(y*width+x))!;
 for(let j=0;j<drops.length;j++){const d=owner(drops[j][0],drops[j][1]),b=owner(blue[j][0],blue[j][1]);expect(d).not.toBe(b);expect(pigmentFamily(d.color)).toBe(4);expect(brightness(d.color)).toBeLessThan(.55);expect(brightness(b.color)).toBeGreaterThan(.7);expect(d.indices.length).toBeGreaterThan(1400);expect(d.indices.length).toBeLessThan(2100);}
 const band=owner(tail[0],tail[1]);expect(brightness(band.color)).toBeLessThan(.55);expect(band.indices.length).toBeGreaterThan(3500);
 const all=r.regions.flatMap(a=>a.indices);expect(new Set(all).size).toBe(all.length);expect(all.length).toBe(r.foregroundPixels-r.discardedPixels);
});
it.each([['front',609,666],['back',0,609]] as const)('preserves original JPEG blue illumination and thin dark ink without inventing navy fabric (%s)',async(_view,left,width)=>{
 const rgba=await sharp('tests/fixtures/character-front-back.jpg').extract({left,top:0,width,height:750}).ensureAlpha().raw().toBuffer(),r=illustrationRegions(width,750,rgba);expect(r.regions.filter(a=>pigmentFamily(a.color)===4&&brightness(a.color)<.55)).toHaveLength(0);
 // Removing an unsupported pink division legitimately changes the whole-image
 // instance count. Original blue interiors and complete foreground ownership
 // independently constrain this test's illumination/material contract.
 const probes=left===609?[[90,510],[110,480]]:[[300,500],[305,300]];
 for(const[x,y]of probes){const i=(y*width+x)*4;expect(rgba[i+2]-rgba[i]).toBeGreaterThan(100);expect(rgba[i+1]-rgba[i]).toBeGreaterThan(80);const source=r.regions.find(p=>p.indices.includes(y*width+x))!;expect(source).toBeDefined();expect(pigmentFamily(source.color)).toBe(4);expect(brightness(source.color)).toBeGreaterThan(.7);}
 const all=r.regions.flatMap(p=>p.indices);expect(new Set(all).size).toBe(all.length);expect(all.length).toBe(r.foregroundPixels-r.discardedPixels);
});

function blueField(){const width=180,height=120,foreground=new Uint8Array(width*height).fill(1),labels=new Int8Array(width*height).fill(4),saturation=new Float32Array(width*height).fill(.55),value=new Float32Array(width*height).fill(.9);return {width,height,foreground,labels,saturation,value};}
it('a broad smooth blue value gradient remains illumination, while a sharp independently supported navy patch stays material',()=>{
 const e=blueField();for(let y=20;y<100;y++)for(let x=20;x<160;x++)e.value[y*e.width+x]=.9-.6*Math.min(1,Math.min(x-20,159-x,y-20,99-y)/30);
 expect(recoverBluePigments(e.width,e.height,e.foreground,e.labels,e.saturation,e.value)).toBe(0);expect([...e.labels].every(v=>v===4)).toBe(true);
 for(let y=40;y<80;y++)for(let x=55;x<75;x++){e.value[y*e.width+x]=.3;e.saturation[y*e.width+x]=.95;}
 // Restore a sharp surrounding blue field so this is independent material evidence.
 for(let y=35;y<85;y++)for(let x=50;x<80;x++)if(x<55||x>=75||y<40||y>=80)e.value[y*e.width+x]=.9;
 expect(recoverBluePigments(e.width,e.height,e.foreground,e.labels,e.saturation,e.value)).toBe(800);expect(e.labels[60*e.width+65]).toBe(7);
});
it('a long three-pixel blue ink valley is not an independent fabric despite sharp contrast',()=>{
 const e=blueField();for(let y=10;y<110;y++)for(let x=80;x<83;x++){e.value[y*e.width+x]=.25;e.saturation[y*e.width+x]=.95;}
 expect(recoverBluePigments(e.width,e.height,e.foreground,e.labels,e.saturation,e.value)).toBe(0);expect(e.labels[60*e.width+81]).toBe(4);
});

it('absorbs only disconnected mixed antialias fringe and preserves a flat bright painted blue island inside supported navy',()=>{
 const e=blueField();for(let y=20;y<100;y++)for(let x=30;x<150;x++){e.value[y*e.width+x]=.3;e.saturation[y*e.width+x]=.95;}
 for(let y=45;y<49;y++)for(let x=65;x<69;x++)e.value[y*e.width+x]=.9;
 e.value[70*e.width+100]=.8;e.value[70*e.width+101]=.6;
 recoverBluePigments(e.width,e.height,e.foreground,e.labels,e.saturation,e.value);expect(e.labels[46*e.width+66]).toBe(4);expect(e.labels[70*e.width+100]).toBe(7);expect(e.labels[70*e.width+101]).toBe(7);
});

it('a hard-edged scalar blue shadow is not an independent pigment merely because its brightness jumps',()=>{
 const e=blueField();for(let y=20;y<100;y++)for(let x=30;x<150;x++)e.value[y*e.width+x]=.3;
 expect(recoverBluePigments(e.width,e.height,e.foreground,e.labels,e.saturation,e.value)).toBe(0);expect([...e.labels].every(v=>v===4)).toBe(true);
});

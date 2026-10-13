import {it,expect} from 'vitest';
import {standingLimbSupport} from '../../packages/reference/standing-limb-support';
function example(){const width=200,height=320,foreground=new Uint8Array(width*height).fill(1),saturation=new Float32Array(width*height),value=new Float32Array(width*height).fill(.9),head={minX:70,minY:40,maxX:130,maxY:85},paws=[{minX:25,minY:160,maxX:50,maxY:185},{minX:150,minY:160,maxX:175,maxY:185}];return {width,height,foreground,saturation,value,head,paws};}
const ridge=(value:Float32Array,width:number,x:number,start:number,end:number)=>{for(let y=start;y<end;y++)value[y*width+x]=.5;};
it('requires persistent bilateral shoulder and central leg seams rather than paired hand positions alone',()=>{
 const e=example(),run=()=>standingLimbSupport(e.width,e.height,e.foreground,e.saturation,e.value,5,305,e.head,e.paws);
 expect(run()).toBeUndefined();for(const x of[75,125])ridge(e.value,e.width,x,95,145);expect(run()).toBeUndefined();for(const x of[93,107])ridge(e.value,e.width,x,165,172);expect(run()).toBeUndefined();for(const x of[93,107])ridge(e.value,e.width,x,165,245);expect(run()?.hipY).toBe(165);
});
it('a single or differently raised hand never enables the bilateral standing frame',()=>{
 const e=example();for(const[x,start,end]of[[75,95,145],[125,95,145],[93,165,245],[107,165,245]])ridge(e.value,e.width,x,start,end);
 expect(standingLimbSupport(e.width,e.height,e.foreground,e.saturation,e.value,5,305,e.head,e.paws.slice(0,1))).toBeUndefined();e.paws[1]={...e.paws[1],minY:40,maxY:65};expect(standingLimbSupport(e.width,e.height,e.foreground,e.saturation,e.value,5,305,e.head,e.paws)).toBeUndefined();
});

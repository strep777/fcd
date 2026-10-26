import {expect,it} from 'vitest';
import {terminalPawSupport} from '../../packages/reference/terminal-paw-support';

it('a supported raised hand does not consume a touching independently classified head material',()=>{
 const width=260,height=360,span=340,saturation=new Float32Array(width*height),value=new Float32Array(width*height);
 const rect=(left:number,top:number,right:number,bottom:number,brightness:number)=>{const ids:number[]=[];for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const i=y*width+x;ids.push(i);saturation[i]=.1;value[i]=brightness;}return ids;};
 const material=(indices:number[])=>({part:'arm' as const,side:'right' as const,confidence:.6,indices});
 const palm=material(rect(150,100,180,135,.85)),tip1=material(rect(157,92,164,101,.05)),tip2=material(rect(181,110,188,119,.05));
 // The head pixels fit the actual positional head classifier's x<150 and
 // y/span<.3 bounds. They are outside the palm, but touch its upper-left
 // corner within the new two-pixel adjacency radius. This is a raised-hand
 // pose beside the face, not overlapping or duplicated source ownership.
 const head={part:'head' as const,side:'center' as const,confidence:.85,indices:rect(147,97,150,100,.05)},regions=[palm,tip1,tip2,head],arm:number[]=[];
 for(let y=125;y<185;y++)for(let x=130+185-y-10;x<130+185-y+10;x++)arm.push(y*width+x);
 const input={width,span,top:0,head:{minX:80,minY:20,maxX:150,maxY:90},regions,saturation,value,arms:new Map<'left'|'right',number[]>([['right',arm]]),existing:new Set<'left'|'right'>()},before=structuredClone(regions);
 const hand=terminalPawSupport(input);expect(hand).toHaveLength(1);expect(hand[0].regionIndices).toEqual(expect.arrayContaining([0,1,2]));expect(regions).toEqual(before);
 expect(hand[0].regionIndices,'Direct pixel proximity must not relabel a separate, well-supported head region as paw').not.toContain(3);
});

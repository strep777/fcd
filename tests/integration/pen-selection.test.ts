import {it,expect} from 'vitest';
import {rasterizePen,flattenPen,type PenPath} from '../../packages/reference/pen-path';
const rect=(x:number,y:number,w:number,h:number,subtract=false):PenPath=>({closed:true,subtract,nodes:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]});
it('combines regions and holes at original resolution',()=>{const r=rasterizePen(900,700,[rect(10,10,800,600),rect(400,100,2,400,true)]);expect(r.count).toBe(479200);expect(r.mask.pixels[100*900+400]).toBe('0');expect(r.mask.pixels[100*900+399]).toBe('1');});
it('clips external paths without writing into neighboring rows',()=>{const r=rasterizePen(20,20,[rect(-15,5,10,10),rect(25,5,10,10),rect(5,5,5,5)]);expect(r.count).toBe(25);expect(r.mask.pixels.slice(0,100)).toBe('0'.repeat(100));});
it('retains bezier handles and rejects open or nonfinite paths',()=>{const p=rect(5,5,10,10);p.nodes[0].out={x:7,y:0};p.nodes[1].in={x:13,y:0};expect(flattenPen(p).length).toBeGreaterThan(4);expect(rasterizePen(20,20,[p]).count).toBeGreaterThan(100);expect(()=>rasterizePen(20,20,[{...p,closed:false}])).toThrow('OPEN_PATH');p.nodes[1].x=NaN;expect(()=>rasterizePen(20,20,[p])).toThrow('INVALID_MASK');});
it('refuses dimensions and path counts beyond the resource budget',()=>{expect(()=>rasterizePen(4097,4096,[])).toThrow();expect(()=>rasterizePen(20,20,Array.from({length:101},()=>rect(1,1,5,5)))).toThrow();});

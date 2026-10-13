import {expect,it} from 'vitest';
import {refineWarmMaterialLabels} from '../../packages/reference/image-warm-materials';

function image(width:number,height:number){
 const rgba=new Uint8Array(width*height*4),foreground=new Uint8Array(width*height).fill(1),labels=new Int8Array(width*height),saturation=new Float32Array(width*height),value=new Float32Array(width*height);
 const paint=(x:number,y:number,rgb:number[],family:number)=>{const i=y*width+x;rgba.set([...rgb,255],i*4);const hi=Math.max(...rgb);saturation[i]=(hi-Math.min(...rgb))/hi;value[i]=hi/255;labels[i]=family;};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)paint(x,y,[178,164,174],0);
 return {width,height,rgba,foreground,labels,saturation,value,paint,run:(budget?:{nodes?:number;operations?:number})=>refineWarmMaterialLabels(width,height,rgba,foreground,labels,saturation,value,budget)};
}

for(const weak of[[220,171,180],[196,170,175],[190,166,174]])for(const thickness of[1,2,3])it(`keeps source-supported pale pink ${weak.join('/')} thin ${thickness} strip and acute tip`,()=>{
 const s=image(100,90),expected:number[]=[];
 for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
  const core=x>=18&&x<43&&y>=22&&y<65,strip=x>=43&&x<72&&y>=35&&y<35+thickness,tip=x>=43&&x<=66-Math.abs(y-57)*2&&y>=47&&y<68;
  if(core||strip||tip){s.paint(x,y,core?[234,147,159]:weak,1);expected.push(y*s.width+x);}
 }
 const actual=s.run();for(const i of expected)expect(actual.labels[i]).toBe(1);
 expect(actual.labels).toEqual(s.labels);
});

for(const thickness of[1,2,3])it(`removes unsupported gray branches ${thickness}px without erasing the pink core`,()=>{
 const s=image(100,90),branches:number[]=[];
 for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
  const core=x>=18&&x<43&&y>=22&&y<65,strip=x>=43&&x<72&&y>=35&&y<35+thickness,tip=x>=43&&x<=66-Math.abs(y-57)*2&&y>=47&&y<68;
  if(core)s.paint(x,y,[234,147,159],1);
  else if(strip||tip){s.paint(x,y,[178,164,174].map(v=>v+((x+y)%2?1:-1)),1);branches.push(y*s.width+x);}
 }
 const actual=s.run();for(const i of branches)expect(actual.labels[i]).toBe(0);expect(actual.labels[40*s.width+30]).toBe(1);
});

function castImage(){
 const s=image(110,80);
 for(let y=10;y<70;y++)for(let x=20;x<86;x++){
  const pink=((x-45)/17)**2+((y-40)/24)**2<1,cast=x>=45&&x<84&&Math.abs(y-40)<23;
  if(pink)s.paint(x,y,[234,147,159],1);else if(cast)s.paint(x,y,[187,154,174],1);
 }
 for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
  const radius=Math.hypot((x-45)/17,(y-40)/24);
  if(radius>.96&&radius<1.04)s.paint(x,y,[106,66,78],1);
  if(Math.hypot(x-45,y-29)<3)s.paint(x,y,[235,234,240],0);
  if(Math.hypot(x-45,y-49)<3)s.paint(x,y,[254,230,237],1);
  if(x===80&&y>35&&y<45)s.paint(x,y,[30,120,240],4);
  if(x<3)s.foreground[y*s.width+x]=0;
 }
 return s;
}
it('uses an original ink boundary to reject warm gray cast while preserving pink, highlight, white hole and other families',()=>{
 const s=castImage(),saved=[s.rgba,s.foreground,s.labels,s.saturation,s.value].map(a=>a.slice()),r=s.run();
 expect(r.labels[40*s.width+82]).toBe(0);expect(r.labels[40*s.width+36]).toBe(1);expect(r.labels[49*s.width+45]).toBe(1);expect(r.labels[29*s.width+45]).toBe(0);
 for(let i=0;i<s.labels.length;i++)if(!s.foreground[i]||s.labels[i]>1)expect(r.labels[i]).toBe(s.labels[i]);
 for(const[i,a]of[s.rgba,s.foreground,s.labels,s.saturation,s.value].entries())expect(a).toEqual(saved[i]);
});

for(const budget of[{nodes:0},{operations:0},{operations:10}])it(`does not commit an incomplete cut when the image budget is ${JSON.stringify(budget)}`,()=>{
 const s=castImage(),r=s.run(budget);expect(r.labels).toEqual(s.labels);expect(r.moved).toBe(0);expect(r.reports.some(x=>x.skipped?.includes('budget'))).toBe(true);
});

it('retains local disagreements inside the existing edge-recovery corridor',()=>{
 const s=image(100,90);
 for(let y=20;y<65;y++)for(let x=18;x<46;x++)s.paint(x,y,x<43?[234,147,159]:[178,164,174],1);
 const r=s.run();expect(r.labels).toEqual(s.labels);expect(r.reports.some(x=>x.skipped==='local-edge-only')).toBe(true);
});

it('retains image-border components and tiny images without wrapped-row adjacency',()=>{
 const s=image(110,80);for(let y=0;y<50;y++)for(let x=15;x<65;x++)s.paint(x,y,x<40?[234,147,159]:[187,154,174],1);
 const r=s.run();expect(r.labels).toEqual(s.labels);expect(r.reports.some(x=>x.skipped==='component-border')).toBe(true);
 const tiny=image(2,30);tiny.labels.fill(1);expect(tiny.run().labels).toEqual(tiny.labels);
});

it('keeps an entire border component fixed when another material window overlaps it',()=>{
 const s=image(110,80),border:number[]=[];
 for(let y=20;y<60;y++)for(let x=0;x<25;x++){s.paint(x,y,x<8?[234,147,159]:[187,154,174],1);border.push(y*s.width+x);}
 for(let y=20;y<60;y++)for(let x=28;x<55;x++)s.paint(x,y,x<35?[234,147,159]:[187,154,174],1);
 for(let y=20;y<60;y++)s.paint(34,y,[106,66,78],1);
 const r=s.run();for(const i of border)expect(r.labels[i]).toBe(1);expect(r.labels[40*s.width+48]).toBe(0);
});

it('caps candidate-window work before returning any partly merged result',()=>{
 const s=image(700,700);for(let row=0;row<20;row++)for(let col=0;col<20;col++)for(let y=0;y<4;y++)for(let x=0;x<8;x++)s.paint(10+col*32+x,10+row*32+y,x<3?[234,147,159]:[187,154,174],1);
 const r=s.run();expect(r.labels).toEqual(s.labels);expect(r.reports[0].skipped).toBe('image-window-budget');
});

it('rejects invalid finite source fields and budgets that try to bypass the bound',()=>{
 const s=image(10,10);s.saturation[5]=NaN;expect(()=>s.run()).toThrow('INVALID_MATERIAL_INPUT');s.saturation[5]=.1;s.value[6]=1.1;expect(()=>s.run()).toThrow('INVALID_MATERIAL_INPUT');s.value[6]=.8;
 expect(()=>s.run({nodes:262145})).toThrow('INVALID_BUDGET');expect(()=>s.run({operations:60000001})).toThrow('INVALID_BUDGET');
});


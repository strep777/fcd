// Source material/support definitions precede every classification call.
// These fixtures contain no algorithm-derived labels or saved output oracle.
export const width=64,height=64,blue=[35,100,230],yellow=[245,220,50],white=[246,246,242],pink=[232,85,132];
type Kind='mixture'|'white'|'gray-gradient'|'alpha128'|'alpha0'|'third';
export type IslandCase={name:string;w:number;h:number;kind:Kind;positive?:boolean};
export type SourceInput={width:number;height:number;rgba:Uint8Array;foreground:Uint8Array;labels:Int8Array;patch:number[]};
export const cases:IslandCase[]=[{name:'opaque-two-pigment-mixture-8px',w:2,h:4,kind:'mixture',positive:true},{name:'true-white-1px',w:1,h:1,kind:'white'},{name:'true-white-4px',w:2,h:2,kind:'white'},{name:'true-white-9px',w:3,h:3,kind:'white'},{name:'true-white-16px',w:4,h:4,kind:'white'},{name:'true-gray-16px-under-nonlinear-light',w:4,h:4,kind:'gray-gradient'},{name:'opaque-mixture-with-semitransparent-support',w:2,h:4,kind:'alpha128'},{name:'opaque-mixture-with-transparent-gap',w:2,h:4,kind:'alpha0'},{name:'true-white-8px-touching-third-color',w:2,h:4,kind:'third'}];
export function fixture(spec:IslandCase):SourceInput{
 const rgba=new Uint8Array(width*height*4),foreground=new Uint8Array(width*height).fill(1),labels=new Int8Array(width*height),x0=32-Math.floor(spec.w/2),y0=32-Math.floor(spec.h/2),patch:number[]=[];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,inside=x>=x0&&x<x0+spec.w&&y>=y0&&y<y0+spec.h;let label=x<32?4:2,rgb=[...(x<32?blue:yellow)],alpha=255;
  if(spec.kind==='gray-gradient'){const light=.9+.1*(x/63)**2,reflection=5*Math.sin(y/12);rgb=rgb.map(v=>Math.round(v*light+reflection));}
  if(inside){patch.push(i);label=0;rgb=['mixture','alpha128','alpha0'].includes(spec.kind)?blue.map((v,c)=>Math.round(v*.6+yellow[c]*.4)):spec.kind==='gray-gradient'?[204,204,204]:[...white];}
  else{const collar=x>=x0-1&&x<=x0+spec.w&&y>=y0-1&&y<=y0+spec.h;if(collar&&spec.kind==='alpha128')alpha=128;if(collar&&spec.kind==='alpha0'){alpha=0;foreground[i]=0;label=-1;}if(spec.kind==='third'&&x===x0+spec.w&&y===y0+Math.floor(spec.h/2)){label=1;rgb=[...pink];}}
  rgba.set([...rgb,alpha],4*i);labels[i]=label;
 }
 return{width,height,rgba,foreground,labels,patch};
}
export type QualificationSpec={name:string;width?:number|'NaN';height?:number;empty?:boolean;cut?:'rgba'|'foreground'|'labels';kind?:'horizontal'|'vertical'|'remote-alpha'|'budget'|'positive'};
export const qualificationCases:QualificationSpec[]=[{name:'zero-width',width:0,height:64},{name:'negative-height',width:64,height:-1},{name:'fractional-width',width:63.5,height:64},{name:'nonfinite-width',width:'NaN',height:64},{name:'oversize',width:4097,height:4096,empty:true},{name:'short-rgba',cut:'rgba'},{name:'short-foreground',cut:'foreground'},{name:'short-labels',cut:'labels'},{name:'horizontal-collinear-core',kind:'horizontal'},{name:'vertical-collinear-core',kind:'vertical'},{name:'remote-semitransparent-support',kind:'remote-alpha'},{name:'late-island-work-exhaustion',kind:'budget'},{name:'opaque-core-control',kind:'positive'}];
export function qualificationFixture(spec:QualificationSpec):SourceInput{
 let f=fixture(cases[0]);
 if(spec.kind==='budget'){
  const width=512,height=512,rgba=new Uint8Array(width*height*4),foreground=new Uint8Array(width*height).fill(1),labels=new Int8Array(width*height),patch:number[]=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x,owner=Math.floor(x/32)%2;labels[i]=owner?2:4;rgba.set([...(owner?yellow:blue),255],4*i);}
  for(let y=24;y<height-16;y+=24)for(let x=32;x<width-16;x+=32){const i=y*width+x;labels[i]=0;rgba.set([...blue.map((v,c)=>Math.round(.6*v+.4*yellow[c])),255],4*i);patch.push(i);}
  f={width,height,rgba,foreground,labels,patch};
 }else if(spec.kind==='horizontal'||spec.kind==='vertical'){
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=y*64+x,inside=spec.kind==='horizontal'?y>=30&&y<=34:x>=30&&x<=34;if(!inside){f.labels[i]=6;f.rgba.set([30,30,30,255],4*i);}else{const owner=spec.kind==='horizontal'?x<32:y<32;f.labels[i]=owner?4:2;f.rgba.set([...(owner?blue:yellow),255],4*i);}}
  f.labels[32*64+32]=0;f.rgba.set([...blue.map((v,c)=>Math.round(.6*v+.4*yellow[c])),255],4*(32*64+32));f.patch=[32*64+32];
 }else if(spec.kind==='remote-alpha')f.rgba[4*(45*64+45)+3]=128;
 if(spec.empty)f={width:typeof spec.width==='number'?spec.width:64,height:spec.height??64,rgba:new Uint8Array(),foreground:new Uint8Array(),labels:new Int8Array(),patch:[]};
 if(spec.width!==undefined)f.width=spec.width==='NaN'?NaN:spec.width;if(spec.height!==undefined)f.height=spec.height;
 if(spec.cut==='labels')f.labels=f.labels.slice(0,-1);else if(spec.cut)f[spec.cut]=f[spec.cut].slice(0,-1);
 return f;
}
export function affineWhiteFixture(cumulative=false):SourceInput{
 const rgba=new Uint8Array(width*height*4),foreground=new Uint8Array(width*height).fill(1),labels=new Int8Array(width*height),patch=[32*width+32],clamp=(v:number)=>Math.max(0,Math.min(255,v));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,left=x<32;labels[i]=left?1:2;
  let rgb=cumulative?(left?[40,230,Math.min(140,111+x)]:[240,70,Math.min(140,174-x)]):(left?[224,clamp(268+8*(x-32)),242]:[clamp(268-8*(x-32)),224,242]);
  if(i===patch[0]){labels[i]=0;rgb=cumulative?[140,150,146]:[246,246,242];}
  rgba.set([...rgb,255],4*i);
 }
 return{width,height,rgba,foreground,labels,patch};
}

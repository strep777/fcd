import {mkdirSync,writeFileSync} from 'node:fs';
import {afterAll,expect,it} from 'vitest';
import sharp from 'sharp';
import {illustrationRegions} from '../../packages/reference/illustration';

const width=120,height=96,base=[238,150,163],outside=[237,231,234];
type Case={name:string;subject:'head'|'paw';separate?:boolean;lighting?:'linear'|'highlight'|'shadow'|'combined';stroke?:number[];strokeWidth?:number;blur?:number};
const lightingCases:Omit<Case,'subject'>[]=[
 {name:'one-pink-linear-light',lighting:'linear'},
 {name:'one-pink-broad-highlight',lighting:'highlight'},
 {name:'one-pink-broad-shadow',lighting:'shadow'},
 {name:'one-pink-combined-reflection-shadow',lighting:'combined'}
];
const blackCases:Omit<Case,'subject'>[]=[
 {name:'two-pink-instances-black-one-pixel',separate:true,stroke:[12,13,18],strokeWidth:1},
 {name:'two-pink-instances-black-two-pixels',separate:true,stroke:[12,13,18],strokeWidth:2}
];
const softCases:Omit<Case,'subject'|'separate'>[]=[
 {name:'soft-brown-line',stroke:[112,63,65],strokeWidth:2,blur:.65},
 {name:'soft-pink-line',stroke:[157,83,113],strokeWidth:2,blur:.65}
];
const cases:Case[]=[
 ...(['head','paw']as const).flatMap(subject=>[...lightingCases,...blackCases].map(c=>({...c,subject,name:subject+'-'+c.name}))),
 ...softCases.map(c=>({...c,subject:'paw'as const,separate:true,name:'paw-two-pink-instances-'+c.name})),
 ...softCases.map(c=>({...c,subject:'head'as const,separate:false,name:'head-one-pink-fold-'+c.name}))
];
const records:unknown[]=[],stage=process.env.FPCAD_PINK_STAGE??'diagnostic',directory='test-results/contour-repair/pink-source-material/'+stage;
if(!/^[a-z0-9-]+$/.test(stage))throw Error('INVALID_PINK_STAGE');

// Material/instance identity precedes RGB rendering. Smooth light changes do
// not create another pink instance. A fixed thin drawn separator can do so
// in paw context, even when its ink borrows adjacent pigment. The identical
// soft stroke is a retained head/inner-ear fold in the explicit head context.
function identity(x:number,y:number,c:Case){
 if(x<16||x>=104||y<12||y>=84)return'outside';
 if(!c.separate)return'pink';
 if(x>=60&&x<60+c.strokeWidth!)return'separator';
 return x<60?'left-pink':'right-pink';
}
function color(x:number,y:number,c:Case){
 const material=identity(x,y,c);if(material==='outside')return outside;
 if(c.stroke&&x>=60&&x<60+c.strokeWidth!)return c.stroke;
 const highlight=Math.exp(-((x-43)**2+(y-34)**2)/(2*15**2)),shadow=Math.exp(-((x-78)**2+(y-59)**2)/(2*17**2));
 if(c.lighting==='linear')return base.map(v=>v*(.64+.36*(x-16)/88));
 if(c.lighting==='highlight')return base.map((v,k)=>v+([255,244,245][k]-v)*.55*highlight);
 if(c.lighting==='shadow')return base.map(v=>v*(1-.35*shadow));
 if(c.lighting==='combined')return base.map((v,k)=>(v+([255,244,245][k]-v)*.45*highlight)*(1-.32*shadow));
 return base;
}

it.each(cases)('$name preserves independently specified pink instance ownership',async c=>{
 const source=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)source.set([...color(x+.5,y+.5,c).map(v=>Math.round(Math.max(0,Math.min(255,v)))),255],(y*width+x)*4);
 const rgba=c.blur?new Uint8Array(await sharp(source,{raw:{width,height,channels:4}}).blur(c.blur).raw().toBuffer()):source,preserved=rgba.slice(),result=illustrationRegions(width,height,rgba,false,c.subject),labels=new Int32Array(width*height).fill(-1);
 result.regions.forEach((r,id)=>r.indices.forEach(i=>labels[i]=id));const owner=(x:number,y:number)=>labels[Math.floor(y)*width+Math.floor(x)],outsideOwner=owner(6.5,48.5),leftOwner=owner(32.5,48.5),rightOwner=owner(86.5,48.5),probes:{x:number;y:number;truth:string;owner:number}[]=[];
 // Deep source interiors stay outside the rendered stroke/AA corridor. The
 // fixed source rectangle and separator determine probes, never output masks.
 for(let y=18.5;y<78;y+=4)for(let x=22.5;x<98;x+=4){if(c.stroke&&Math.abs(x-61)<6)continue;probes.push({x,y,truth:identity(x,y,c),owner:owner(x,y)});}
 const expectedOwner=(truth:string)=>truth==='right-pink'?rightOwner:leftOwner,wrong=probes.filter(p=>p.owner!==expectedOwner(p.truth)),owners=[...new Set(probes.map(p=>p.owner))],separatorSourcePixels=c.stroke?Array.from({length:72*c.strokeWidth!},(_,i)=>({x:60+i%c.strokeWidth!,y:12+Math.floor(i/c.strokeWidth!)})):[];
 records.push({name:c.name,subject:c.subject,separate:!!c.separate,oracle:c.separate?'Two independently prescribed pink instances separated by a fixed full-height ink stroke in the stated context. Ink pigment family is deliberately not asserted.':c.stroke?'One independently prescribed head material with a soft internal fold; the identical RGB stroke is not a cutting boundary in head context.':'One independently prescribed pink instance under spatially continuous lighting; the source has no internal material boundary.',leftOwner,rightOwner,outsideOwner,deepPinkOwners:owners,wrongInteriorProbes:wrong,regions:result.regions.map((r,id)=>({id,color:r.color,pixels:r.indices.length})),separatorSourcePixels});
 mkdirSync(directory,{recursive:true});await sharp(rgba,{raw:{width,height,channels:4}}).png().toFile(directory+'/'+c.name+'-source.png');
 expect(Buffer.from(rgba).equals(Buffer.from(preserved)),'classification cannot mutate source RGBA').toBe(true);
 expect.soft(leftOwner,'pink interior is retained').toBeGreaterThanOrEqual(0);expect.soft(rightOwner,'pink interior is retained').toBeGreaterThanOrEqual(0);
 expect.soft(leftOwner,'pink remains separate from the independently painted neutral surroundings').not.toBe(outsideOwner);expect.soft(rightOwner).not.toBe(outsideOwner);
 if(c.separate)expect.soft(leftOwner,'a true source separator must keep the two pink instances distinct').not.toBe(rightOwner);else expect.soft(rightOwner,'lighting or a retained head fold cannot split a single pink material instance').toBe(leftOwner);
 expect.soft(wrong,'all deep source pink probes keep their prescribed instance owner').toEqual([]);
});

afterAll(()=>{mkdirSync(directory,{recursive:true});writeFileSync(directory+'/metrics.json',JSON.stringify({scope:'Synthetic illustration classification only. Independent material identities and exact one/two-pixel separator coordinates precede lighting and optional Gaussian blur. No geometry/native/desktop/JPEG replay. A source screenshot is not the material oracle.',records},null,2));});

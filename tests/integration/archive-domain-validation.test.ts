import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {expect,it} from 'vitest';
import {pack,unpack} from '../../apps/desktop/main/archive';
import {projectSchema} from '../../packages/schema/index';
import {project} from '../fixtures';

// Change a valid archive while keeping its manifest consistent, so these cases
// exercise domain validation rather than the earlier content hash check.
function edited(file:string,edit:(value:any)=>void){
 const files=unzipSync(pack(project()).bytes),value=JSON.parse(strFromU8(files[file]));
 edit(value);files[file]=strToU8(JSON.stringify(value));
 const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
 const manifest=JSON.parse(strFromU8(files['manifest.json']));
 manifest.files=Object.keys(files).filter(path=>path!=='manifest.json').sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(path=>({path,size:files[path].length,sha256:digest(files[path])}));
 manifest.contentHash=digest(JSON.stringify(manifest.files));files['manifest.json']=strToU8(JSON.stringify(manifest));
 return zipSync(files,{level:0});
}

it.each([
 ['patterns.json',(p:any)=>{p.pieces[0].nodes[0].xMm='invalid';}],
 ['patterns.json',(p:any)=>{delete p.pieces;}],
 ['body.json',(p:any)=>{p.surface={id:'invalid',vertices:[],faces:[]};}],
 ['materials.json',(p:any)=>{p.materials=[{name:'unfinished material'}];}],
 ['materials.json',(p:any)=>{p.items=[{name:'unsupported record'}];}],
 ['project.json',(p:any)=>{p.modelLibrary=[{id:'invalid',surface:{vertices:[]}}];}],
 ['project.json',(p:any)=>{p.pieces=[];}],
 ['body.json',(p:any)=>{p.schemaVersion=1;}],
] as const)('still rejects incomplete or invalid domain data in %s',(file,edit)=>{
 expect(()=>unpack(edited(file,edit))).toThrow();
});

it('normalizes once while preserving exact fractional coordinates and archive semantics',()=>{
 const p=project();p.name='  工程  ';p.pieces[0].nodes[0].xMm=-5.5108101000737325e-15;
 const restored=unpack(pack(p).bytes);
 expect(restored).toEqual(projectSchema.parse(p));
 expect(restored.pieces[0].nodes[0].xMm).toBe(p.pieces[0].nodes[0].xMm);
 expect(unpack(pack(restored).bytes)).toEqual(restored);
});

it('reads a bounded archive view without consuming or changing its surrounding bytes',()=>{
 const input=project(),archive=pack(input).bytes,storage=new Uint8Array(17+archive.length+23).fill(0xa5);
 storage.set(archive,17);const before=storage.slice(),view=storage.subarray(17,17+archive.length);
 expect(view.byteOffset).toBeGreaterThan(0);expect(unpack(view)).toEqual(input);expect(storage).toEqual(before);
});

import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {project,rectangle} from '../fixtures';
import {cutBundle,readCutBundle} from '../../apps/desktop/main/workflow-exchange';
import {bundleFontPath,exportFontSync} from '../../apps/desktop/main/export-assets';
import {svgExport} from '../../apps/desktop/main/export';
import {analyze} from '../../apps/desktop/main/worker';
import {pack} from '../../apps/desktop/main/archive';
import {hash} from '../../apps/desktop/main/repository';

const worker=resolve('target/release/fpcad-worker.exe');

it('exports and reopens 63 real analyzed pieces with one shared font while standalone SVG retains its embedded font',async()=>{
 const p=project();p.pieces=Array.from({length:63},(_,i)=>({...rectangle(20,30),name:`纸样 ${i+1}`}));
 const before=structuredClone(p),geometry=await analyze(worker,p),font=exportFontSync();
 expect(geometry).toHaveLength(63);expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error'))).toEqual([]);
 // Repeating the embedded font alone exceeded the entire old bundle budget.
 expect(Math.ceil(font.length/3)*4*p.pieces.length).toBeGreaterThan(200*1024*1024);
 const bytes=cutBundle(p,geometry),files=unzipSync(bytes),catalog=JSON.parse(strFromU8(files['catalog.json']));
 expect(bytes.length).toBeLessThan(10*1024*1024);expect(Object.keys(files)).toHaveLength(66);
 expect(Buffer.from(files[bundleFontPath])).toEqual(font);expect(catalog.previews).toBe(true);
 expect(catalog.files.filter((file:{path:string})=>file.path===bundleFontPath)).toEqual([{path:bundleFontPath,size:font.length,sha256:hash(font)}]);
 for(const piece of p.pieces){const svg=strFromU8(files[`pieces/${piece.id}.svg`]);expect(svg).toContain(`src:url("../${bundleFontPath}")`);expect(svg).not.toContain('data:font/ttf;base64,');expect(svg).toContain('font-family="FurryPattern Sans SC"');}
 expect(readCutBundle(bytes)).toEqual(p);expect(p).toEqual(before);
 const standalone=svgExport(p,geometry,[]);expect(standalone).toContain('data:font/ttf;base64,');expect(standalone).not.toContain(`../${bundleFontPath}`);
},60000);

it('continues to open historical bundles containing project and SVG previews without a shared font file',()=>{
 const p=project(),files:Record<string,Uint8Array>={'project.fpcad':pack(p).bytes,[`pieces/${p.pieces[0].id}.svg`]:strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="200mm"><path d="M0 0H100V200H0Z"/></svg>')};
 files['catalog.json']=strToU8(JSON.stringify({format:'fpcad-cuts',version:1,projectId:p.id,revision:p.revision,previews:true,pieces:p.pieces.map(piece=>({id:piece.id,name:piece.name,color:piece.color,cutQty:piece.cutQty})),files:Object.entries(files).map(([path,bytes])=>({path,size:bytes.length,sha256:hash(bytes)}))}));
 expect(readCutBundle(zipSync(files,{level:0}))).toEqual(p);
});

it('checks the shared font against the catalog instead of accepting a damaged or unlisted font resource',async()=>{
 const p=project(),geometry=await analyze(worker,p),files=unzipSync(cutBundle(p,geometry));
 const damaged={...files,[bundleFontPath]:Uint8Array.from(files[bundleFontPath])};damaged[bundleFontPath][100]^=1;
 expect(()=>readCutBundle(zipSync(damaged,{level:0}))).toThrow('HASH_MISMATCH');
 const catalog=JSON.parse(strFromU8(files['catalog.json']));catalog.files=catalog.files.filter((file:{path:string})=>file.path!==bundleFontPath);
 expect(()=>readCutBundle(zipSync({...files,'catalog.json':strToU8(JSON.stringify(catalog))},{level:0}))).toThrow('INVALID_ARCHIVE');
},60000);

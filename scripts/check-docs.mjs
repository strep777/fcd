import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';

const root=resolve('.'),docs=resolve('Docs'),files=[],errors=[];
function walk(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())walk(path);else if(entry.name.endsWith('.md'))files.push(path);}}
walk(docs);
files.push(resolve('README.md'),resolve('AGENTS.md'),resolve('scripts/README.md'),resolve('tests/README.md'));
let links=0;
for(const file of files){
 const source=readFileSync(file,'utf8').replace(/```[^\n]*\n[\s\S]*?```/g,'');
 for(const match of source.matchAll(/\[[^\]\n]+\]\(([^\n)]+)\)/g)){
  let target=match[1].trim().replace(/^<|>$/g,'');
  if(/^[a-z][\w+.-]*:/i.test(target)||target.startsWith('//')||target.startsWith('#'))continue;
  target=target.replace(/\s+"[^"]*"$/,'').split('#')[0];if(!target)continue;
  let decoded;try{decoded=decodeURIComponent(target);}catch{decoded=target;}
  links++;if(!existsSync(resolve(dirname(file),decoded)))errors.push(`${relative(root,file)} → ${target}`);
 }
}
const report={passed:errors.length===0,scope:'当前文档本地链接检查；不代表软件验收',markdownFiles:files.length,localLinks:links,errors};
mkdirSync('test-results',{recursive:true});writeFileSync('test-results/docs-validation.json',JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log(`文档检查通过：${files.length} 个 Markdown 文件，${links} 个本地链接。`);

import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktopArgs,executablePath,testedBuild} from './desktop-launch.mjs';
const directory=await mkdtemp(resolve('.local/tests/control-spacing-')),env={...process.env,FPCAD_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath,args:desktopArgs,env}),page=await app.firstWindow(),checks=[],problems=[];
try{
 await page.setViewportSize({width:1440,height:960});await page.getByRole('button',{name:'＋ 新建项目',exact:true}).first().click();await page.getByRole('dialog').locator('input').fill('控件间距检查');await page.getByRole('button',{name:'创建 →',exact:true}).click();await page.locator('.workflow-nav>button[data-stage=model]').click();
 const mesh=JSON.parse(await readFile('assets/templates/calibration-shell.fpctemplate','utf8')),indices=new Map(mesh.vertices.map((v,i)=>[v.id,i+1])),path=resolve(directory,'shell.obj');await writeFile(path,mesh.vertices.map(v=>'v '+v.xMm+' '+v.yMm+' '+v.zMm).concat(mesh.faces.map(f=>'f '+f.vertices.map(v=>indices.get(v)).join(' '))).join('\n'));await app.evaluate(({dialog},path)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]}),path);await page.getByRole('button',{name:'导入三角 OBJ / GLB',exact:true}).click();await page.locator('.surface-view').waitFor();
 for(const stage of ['references','model','mapping','cutting','pattern']){
  await page.locator('.workflow-nav>button[data-stage="'+stage+'"]').click();
  const result=await page.evaluate(()=>{
   const visible=[...document.querySelectorAll('.workspace button,.workspace input:not([type=checkbox]):not([type=range]):not([type=radio]),.workspace select,.workspace textarea')].filter(el=>{const r=el.getBoundingClientRect();if(!r.width||!r.height||r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth)return false;const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit&&(el===hit||el.contains(hit));});
   const rows=visible.map(el=>({el,r:el.getBoundingClientRect(),label:el.getAttribute('aria-label')||el.textContent?.trim().slice(0,60)||el.parentElement?.textContent?.trim().slice(0,60)})),touch=[];
   for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j];if(a.el.contains(b.el)||b.el.contains(a.el))continue;const overlapX=Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left),overlapY=Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top);if(overlapX>4&&overlapY>=-.1||overlapY>4&&overlapX>=-.1)touch.push([a.label,b.label]);}
   return {count:rows.length,touch};
  });checks.push({stage,...result});problems.push(...result.touch.map(pair=>({stage,pair})));
 }
 await writeFile('test-results/control-spacing.json',JSON.stringify({passed:!problems.length,testedBuild,checks,problems},null,2));assert.deepEqual(problems,[]);console.log('Control spacing passed');
}finally{await app.close();}

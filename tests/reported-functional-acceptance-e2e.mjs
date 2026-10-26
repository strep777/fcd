// Prepared for the coordinated implementation freeze. This file must be run
// only after the real Rust worker and hidden native desktop have been rebuilt.
// node --import ./tests/desktop-child-process.mjs tests/reported-functional-acceptance-e2e.mjs
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktop} from './tauri-desktop.mjs';
import {desktopArgs, executablePath, testedBuild} from './desktop-launch.mjs';
import {desktopScreenshot} from './desktop-screenshot.mjs';
import {chooseProject, workflow} from './ui-navigation.mjs';
import {waitForCutCandidate, assertDesignCutContract} from './cut-result-contract.mjs';
import {auditRuntime, testedArtifacts, sha256} from './real-mapping-fixture-audit.mjs';
import {assertCharacterSeparation, assertRegularBodyPieceBudget, assertBodyModelScope, characterFixture} from './fixtures/character-functional-oracle.mjs';

const output=resolve(process.env.FPCAD_FUNCTIONAL_RESULTS??'test-results/reported-functional-acceptance');
const groups=(process.env.FPCAD_FUNCTIONAL_GROUPS??'jpeg,models,ui').split(',');
assert(groups.length>0&&new Set(groups).size===groups.length&&groups.every(g=>['jpeg','models','ui'].includes(g)),'Choose explicit jpeg,models,ui acceptance groups');
const modelModes=(process.env.FPCAD_FUNCTIONAL_MODEL_MODES??'dtd,padded').split(',');
assert(modelModes.length>0&&new Set(modelModes).size===modelModes.length&&modelModes.every(m=>['dtd','padded'].includes(m)),'Choose explicit dtd,padded model cases');
await mkdir(output,{recursive:true});
const directory=await mkdtemp(resolve('.local/tests/reported-functional-acceptance-'));
const app=await desktop.launch({args:desktopArgs,executablePath,env:{...process.env,FPCAD_DATA_DIR:directory}});
const page=await app.firstWindow(), errors=[], checks=[];
page.setDefaultTimeout(30000);
page.on('pageerror',error=>errors.push(error.message));
const report={passed:false,testedBuild,directory,checks,errors,groups,modelModes,excludedModelModes:['dtd','padded'].filter(m=>!modelModes.includes(m)),excludedFromThisRun:['jpeg','models','ui'].filter(g=>!groups.includes(g)),
  scope:'Native desktop semantic extraction, regular-body panel quality and simple-mode visibility. Projection matrix, smooth-boundary quality and visual silhouette review remain separate required gates.'};
async function read(){const r=await page.evaluate(()=>window.fpcad.read());assert(r.ok,JSON.stringify(r));return r.data.project;}
async function check(name,callback){
  console.log('START '+name);
  try{checks.push({name,passed:true,evidence:await callback()});console.log('PASS '+name);}
  catch(error){checks.push({name,passed:false,error:String(error.stack??error)});await desktopScreenshot(app,page,{path:resolve(output,name+'-failure.png')}).catch(()=>{});}
  finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));}
}
try{
  await page.setViewportSize({width:1440,height:1000});
  await page.waitForFunction(()=>!!window.fpcad);
  assert(app.process()?.pid,'A browser component fixture is not native desktop acceptance');
  report.webview=await app.webviewLaunchInfo();
  assert(report.webview.processes.length>0,'Capture the actual WebView2 descendant processes');
  assert(await app.evaluate(({DesktopWindow})=>DesktopWindow.getAllWindows().every(w=>!w.isVisible())),'All test windows remain hidden');
  const applicationDirectory=await app.evaluate(({host})=>host.getAppPath());
  report.artifacts=await testedArtifacts(undefined,applicationDirectory);
  const nativeHostPath=resolve(executablePath??'apps/desktop/src-tauri/target/debug/FurryPatternCAD.exe');
  report.nativeHost={path:nativeHostPath,sha256:sha256(await readFile(nativeHostPath))};
  const helpers=await auditRuntime(directory);

  if(groups.includes('jpeg'))await check('jpeg-semantic-separation',async()=>{
    await app.evaluate(({dialog},path)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]}),resolve(characterFixture.path));
    const seeded=await page.evaluate(async()=>{
      let r=await window.fpcad.create({name:'Original JPEG semantic acceptance',unit:'mm'});
      if(!r.ok)return r;
      const p=r.data.project;
      return window.fpcad.autoReference(p.id,p.revision,'front-right',1800,8,true);
    });
    assert(seeded.ok,JSON.stringify(seeded));
    const project=await read();
    await writeFile(resolve(output,'jpeg-extracted-project.json'),JSON.stringify(project));
    // Capture the actual extracted vectors even when the semantic gate fails.
    await page.reload();await workflow(page,'references');
    await desktopScreenshot(app,page,{path:resolve(output,'jpeg-extraction.png')});
    // This oracle evaluates saved cubic vectors, not illustrationRegions masks.
    const evidence=await assertCharacterSeparation(project,{onEvidence:e=>writeFile(resolve(output,'jpeg-semantic-evidence.json'),JSON.stringify(e,null,2))});
    return evidence;
  });

  if(groups.includes('models'))for(const bodyMode of modelModes) await check(bodyMode+'-body-panels',async()=>{
    const parameters=helpers.speciesDefaults('canine',bodyMode);
    const generated=await page.evaluate(async parameters=>{
      let r=await window.fpcad.create({name:'Regular '+parameters.bodyMode+' body acceptance',unit:'mm'});
      if(!r.ok)return r;
      const p=r.data.project;
      return window.fpcad.generateSpecies(p.id,p.revision,parameters);
    },parameters);
    assert(generated.ok,JSON.stringify(generated));
    const input=await read();
    assert.equal(input.markings?.length??0,0,'The regular-body quality gate uses unmarked cloth, so tiny details cannot justify mesh fragments');
    await page.reload();await workflow(page,'model');
    const panel=page.locator('.surface-panel');
    for(const [view,label] of [['front','正面'],['side','左侧'],['back','背面']]){
      await panel.getByRole('button',{name:label,exact:true}).click();
      await desktopScreenshot(app,panel,{path:resolve(output,bodyMode+'-'+view+'.png')});
    }
    await writeFile(resolve(output,bodyMode+'-input.json'),JSON.stringify(input));
    const modelScope=assertBodyModelScope(input.surface,bodyMode);
    await writeFile(resolve(output,bodyMode+'-model-scope.json'),JSON.stringify(modelScope,null,2));
    await workflow(page,'cutting');
    // Invoke the actual default user action. Never set maxPieces=50 to force
    // rejection or replace the native worker with a prerecorded candidate.
    await page.getByRole('button',{name:'自动计算裁线并预览',exact:true}).click();
    await waitForCutCandidate(page);
    const candidate=await read();
    await writeFile(resolve(output,bodyMode+'-candidate-project.json'),JSON.stringify(candidate));
    await writeFile(resolve(output,bodyMode+'-candidate.json'),JSON.stringify(candidate.surfaceRun));
    const physical=assertDesignCutContract(candidate),usability=assertRegularBodyPieceBudget(candidate);
    await desktopScreenshot(app,page,{path:resolve(output,bodyMode+'-cutting.png')});
    return {physical,usability,modelScope,inputRevision:input.revision,candidateRevision:candidate.revision,
      visualReview:'REQUIRED: compare front/side/back silhouettes and structural seams to the checked-in references; screenshots alone do not establish a pass'};
  });

  if(groups.includes('ui'))await check('simple-manufacturing-tabs',async()=>{
    // This check is independent of whether extraction or unfolding passed.
    if(!(await read())?.surface){
      const r=await page.evaluate(()=>window.fpcad.create({name:'Simple manufacturing visibility',unit:'mm'}));
      assert(r.ok,JSON.stringify(r));
    }
    await page.reload();await chooseProject(page);
    await page.getByLabel('界面模式',{exact:true}).selectOption('false');
    await page.locator('.workflow-nav>button[data-stage="pattern"]').click();
    const tabs=page.locator('.pattern-subtabs');
    await tabs.getByRole('tab',{name:'版型预览',exact:true}).waitFor({state:'visible'});
    assert(await tabs.getByRole('tab',{name:'版型预览',exact:true}).isVisible(),'Simple mode exposes the pattern preview');
    for(const name of ['材料','接缝','排料'])assert.equal(await tabs.getByRole('tab',{name,exact:true}).isVisible(),false,`${name} is advanced-only`);
    await desktopScreenshot(app,page,{path:resolve(output,'simple-manufacturing.png')});
    await page.getByLabel('界面模式',{exact:true}).selectOption('true');
    for(const name of ['材料','接缝','排料'])assert(await tabs.getByRole('tab',{name,exact:true}).isVisible(),`${name} remains available in advanced mode`);
    await tabs.getByRole('tab',{name:'材料',exact:true}).click();
    await page.getByLabel('界面模式',{exact:true}).selectOption('false');
    assert.equal(await tabs.getByRole('tab',{name:'材料',exact:true}).isVisible(),false);
    assert.equal(await page.locator('.pattern-tools .materials-panel').isVisible(),false,'Returning to simple mode must also leave an already active advanced panel');
    return {advancedOnly:['材料','接缝','排料'],checkedAfterLeavingActiveAdvancedTab:true};
  });

  assert(await app.evaluate(({DesktopWindow})=>DesktopWindow.getAllWindows().every(w=>!w.isVisible())));
  assert.deepEqual(errors,[]);
  const expectedChecks=Number(groups.includes('jpeg'))+modelModes.length*Number(groups.includes('models'))+Number(groups.includes('ui'));
  report.passed=checks.length===expectedChecks&&checks.every(c=>c.passed);
  assert(report.passed,checks.filter(c=>!c.passed).map(c=>c.name+': '+c.error).join('\n'));
}catch(error){report.error=String(error.stack??error);throw error;}
finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await app.close();}

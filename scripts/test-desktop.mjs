import {execFile} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {testedBuild} from '../tests/desktop-launch.mjs';
const cli=process.argv.slice(2),jobsIndex=cli.indexOf('--jobs');let jobs=1;
if(jobsIndex>=0){jobs=Number(cli[jobsIndex+1]);if(!Number.isInteger(jobs)||jobs<1||jobs>3)throw Error('Desktop jobs must be 1 to 3');cli.splice(jobsIndex,2);}
const retest=cli[0]==='--retest',suites=cli.slice(retest?1:0);
if(retest&&!suites.length)throw Error('Retest requires explicit suite names');
const selected=suites.length?suites:['large-auto-mapping-e2e','complex-source-drop-e2e','large-preview-e2e','assembly-preview-e2e','assembly-closed-model-e2e','assembly-archive-integrity-e2e','model-connections-e2e','reference-repeat-e2e','extraction-refinement-e2e','provider-ui-e2e','japanese-ui-e2e','control-spacing-e2e','assistant-settings-e2e','mapping-revision-e2e','cutting-library-e2e','session-deletion-e2e','workspace-interactions-e2e','clean-start-e2e','e2e','offline-e2e','recovery-e2e','advanced-e2e','manufacturing-e2e','mask-e2e','template-e2e','completion-e2e','large-mesh-e2e','cluster-e2e','picking-e2e','ui-workflow-e2e','resources-e2e','inference-e2e','real-dual-view-e2e','audit-e2e','workflow-pages-e2e','print-pages-e2e','cut-tools-e2e','cut-workspace-e2e','workflow-audit-e2e','page-layout-e2e','operation-guards-e2e','corrupt-session-e2e','simple-markings-e2e','model-entry-e2e','reference-workspace-e2e','studio-ui-e2e','lifecycle-e2e','late-cancel-e2e','extraction-safety-e2e','original-pen-e2e','mapping-usability-e2e','session-drafts-e2e','reference-workflow-e2e','model-surface-workflow-e2e','manufacturing-preview-e2e','attached-editing-e2e','surface-rendering-e2e','source-region-editor-e2e','source-draft-history-e2e','mapping-edit-history-e2e','draft-command-order-e2e','parameter-history-e2e','real-mapping-preview-e2e','library-registration-e2e'];
mkdirSync('test-results/desktop',{recursive:true});
const report=retest?JSON.parse(readFileSync('test-results/desktop-verification.json','utf8')):{time:new Date().toISOString(),build:testedBuild,osSandboxDisabledForTest:process.env.FPCAD_TEST_NO_SANDBOX==='1',passed:false,results:[]};
if(retest){
 if(JSON.stringify(report.build)!==JSON.stringify(testedBuild))throw Error('Retest build must match the original report');
 if(suites.some(suite=>!report.results.some(result=>result.suite===suite)))throw Error('Retest suites must exist in the original report');
 mkdirSync('test-results/desktop-attempts',{recursive:true});
 const time=new Date().toISOString(),archive=`test-results/desktop-attempts/${time.replaceAll(':','-')}.json`;
 writeFileSync(archive,JSON.stringify(report,null,2));report.retests=[...(report.retests??[]),{time,suites,previousReport:archive}];report.passed=false;
}
for(const suite of selected)if(!/^[a-z0-9-]+$/.test(suite))throw Error('Invalid suite name');
if(new Set(selected).size!==selected.length)throw Error('Duplicate suite names');
const dependencies={'studio-ui-e2e':['workflow-pages-e2e','simple-markings-e2e']},pending=new Set(selected),running=new Map(),done=new Set();
async function runSuite(suite){
 if(!/^[a-z0-9-]+$/.test(suite))throw Error('Invalid suite name');
 const start=Date.now(),r=await new Promise(resolve=>execFile(process.execPath,[`tests/${suite}.mjs`],{encoding:'utf8',maxBuffer:16*1024*1024,env:process.env},(error,stdout,stderr)=>resolve({status:error?(typeof error.code==='number'?error.code:1):0,stdout,stderr,error})));
 writeFileSync(`test-results/desktop/${suite}.log`,(r.stdout??'')+(r.stderr??'')+(r.error?.message??''));
 const result={suite,exitCode:r.status,durationMs:Date.now()-start,...(retest?{retestedAt:new Date().toISOString()}:{})},index=report.results.findIndex(item=>item.suite===suite);
 if(index<0)report.results.push(result);else report.results[index]=result;
 console.log(suite,r.status===0?'passed':'FAILED');if(r.status!==0)console.error(r.stdout,r.stderr,r.error??'');
 writeFileSync('test-results/desktop-verification.json',JSON.stringify(report,null,2));
}
while(pending.size||running.size){
 for(const suite of pending){if(running.size>=jobs)break;if((dependencies[suite]??[]).some(dependency=>selected.includes(dependency)&&!done.has(dependency)))continue;pending.delete(suite);const work=runSuite(suite).finally(()=>{running.delete(suite);done.add(suite);});running.set(suite,work);}
 if(!running.size)throw Error('Desktop suite dependency cycle');await Promise.race(running.values());
}
if(!retest)report.results.sort((a,b)=>selected.indexOf(a.suite)-selected.indexOf(b.suite));
report.concurrency=jobs;
report.passed=report.results.every(r=>r.exitCode===0);writeFileSync('test-results/desktop-verification.json',JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;



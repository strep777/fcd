import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Project,Response,Session} from '../../packages/schema/index';
import {Repository} from '../../apps/desktop/main/repository';
import * as archive from '../../apps/desktop/main/archive';

const host=vi.hoisted(()=>{
 let ready!:()=>void;
 return {save:vi.fn(),open:vi.fn(),publish:vi.fn(),nativeCall:vi.fn(),receive:undefined as undefined|((channel:string,payload:unknown)=>Promise<unknown>),shutdown:undefined as undefined|(()=>Promise<void>),ready:new Promise<void>(resolve=>{ready=resolve;}),started:()=>ready()};
});
const worker=vi.hoisted(()=>({analyze:vi.fn(async()=>[])}));
vi.mock('../../apps/desktop/main/host-channel',()=>({dialogs:{save:host.save,open:host.open},publish:host.publish,nativeCall:host.nativeCall,serve:(receive:typeof host.receive,shutdown:typeof host.shutdown)=>{host.receive=receive;host.shutdown=shutdown;host.started();}}));
vi.mock('../../apps/desktop/main/worker',async original=>({...await original<typeof import('../../apps/desktop/main/worker')>(),analyze:worker.analyze}));

let directory:string,project:Project,published:Session;
const checkpoint=vi.spyOn(Repository.prototype,'checkpoint'),snapshot=vi.spyOn(Repository.prototype,'snapshot'),write=vi.spyOn(archive,'atomicWrite');
function untouched(){expect(snapshot).not.toHaveBeenCalled();expect(worker.analyze).not.toHaveBeenCalled();expect(checkpoint).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();}
const choice=(result:{canceled:boolean;filePath?:string;filePaths?:string[]})=>async()=>{untouched();return result;};
async function request(method:string,payload:unknown,scoped=true){return await host.receive!('fpcad:request',{protocolVersion:1,requestId:randomUUID(),method,payload,...(scoped?{projectId:project.id,expectedRevision:project.revision}:{})}) as Response;}
beforeAll(async()=>{
 mkdirSync(resolve('.local/tests'),{recursive:true});directory=mkdtempSync(resolve('.local/tests/output-order-'));
 vi.stubEnv('FPCAD_DATA_DIR',directory);await import('../../apps/desktop/main/main');await host.ready;
});
beforeEach(async()=>{
 const result=await request('project.create',{name:'Output confirmation',unit:'mm'},false);if(!result.ok)throw Error(result.error.code);project=result.data.project!;published=result.data;
 host.save.mockReset().mockImplementation(choice({canceled:true}));host.open.mockReset().mockImplementation(choice({canceled:true,filePaths:[]}));worker.analyze.mockClear();checkpoint.mockClear();snapshot.mockClear();write.mockClear();
});
afterAll(async()=>{await host.shutdown?.();vi.unstubAllEnvs();checkpoint.mockRestore();snapshot.mockRestore();write.mockRestore();});

it('cancels the project destination before computing or saving an export',async()=>{
 const result=await request('export.create',{format:'svg',warningAckIds:[]});
 expect(result).toMatchObject({ok:true,cancelled:true,data:published});expect(host.save).toHaveBeenCalledTimes(1);expect(host.save.mock.calls[0][0].defaultPath).toBe('Output confirmation.fpcad');untouched();
});

it('cancels the output destination without saving the previously selected project path',async()=>{
 const projectPath=join(directory,'cancelled.fpcad');host.save.mockImplementationOnce(choice({canceled:false,filePath:projectPath})).mockImplementationOnce(choice({canceled:true}));
 const result=await request('export.create',{format:'svg',warningAckIds:[]});
 expect(result).toMatchObject({ok:true,cancelled:true,data:published});expect(host.save).toHaveBeenCalledTimes(2);untouched();expect(existsSync(projectPath)).toBe(false);
});

it('validates export geometry only after both destinations are confirmed',async()=>{
 const projectPath=join(directory,'invalid.fpcad'),outputPath=join(directory,'invalid.svg');
 host.save.mockImplementationOnce(choice({canceled:false,filePath:projectPath})).mockImplementationOnce(choice({canceled:false,filePath:outputPath}));
 const result=await request('export.create',{format:'svg',warningAckIds:[]});
 expect(result).toMatchObject({ok:false,error:{code:'EMPTY_PROJECT'}});expect(snapshot).toHaveBeenCalledOnce();expect(worker.analyze).toHaveBeenCalledOnce();expect(checkpoint).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(existsSync(projectPath)).toBe(false);expect(existsSync(outputPath)).toBe(false);
});

it.each(['workflow.file','patterns.bundle'])('cancels %s before checkpointing or creating the output bundle',async method=>{
 const result=await request(method,{action:'export'});
 expect(result).toMatchObject({ok:true,cancelled:true,data:published});expect(host.save).toHaveBeenCalledOnce();expect(host.save.mock.calls[0][0].defaultPath).toBe('Output confirmation.'+(method==='workflow.file'?'json':'zip'));untouched();
});

it('cancels selected-pattern output before geometry validation or checkpointing',async()=>{
 const result=await request('patterns.output',{format:'svg',pieceIds:[randomUUID()],warningAckIds:[],paper:{widthMm:210,heightMm:297,marginMm:10,overlapMm:10}});
 expect(result).toMatchObject({ok:true,cancelled:true,data:published});expect(host.save).toHaveBeenCalledOnce();untouched();
});

it.each(['template.export','surface.export','project.save'])('opens %s destination and cancels without loading the project or its resources',async method=>{
 const result=await request(method,method==='project.save'?{saveAs:true}:{});expect(result).toMatchObject({ok:true,cancelled:true,data:published});expect(host.save).toHaveBeenCalledOnce();untouched();
});

it.each([
 ['project.open',{},false],['workflow.file',{action:'import'},true],['patterns.bundle',{action:'import'},true],['reference.import',{view:'front'},true],['pattern.import',{scale:1},true],['surface.import',{scale:1},true],['template.import',{},true],
 ['reference.auto',{layout:'sheet',heightMm:1800,clusters:6,excludeBackground:true},true],['reference.auto',{layout:'front-right',heightMm:1800,clusters:6,excludeBackground:true},true],['reference.auto',{layout:'separate',heightMm:1800,clusters:6,excludeBackground:true},true],
] as const)('opens %s file choices and cancels without loading or changing the project',async(method,payload,scoped)=>{
 const result=await request(method,payload,scoped);expect(result).toMatchObject({ok:true,cancelled:true,data:published});expect(host.open).toHaveBeenCalledOnce();untouched();
});

it.each(['sheet','front-right','separate'])('selects one complete reference sheet for %s and preserves the project when its file cannot be read',async layout=>{
 host.open.mockImplementationOnce(choice({canceled:false,filePaths:[join(directory,'missing-reference-sheet.png')]}));
 const result=await request('reference.auto',{layout,heightMm:1800,clusters:6,excludeBackground:true});
 expect(result).toMatchObject({ok:false,error:{code:'IO_ERROR'}});expect(host.open).toHaveBeenCalledOnce();untouched();
});

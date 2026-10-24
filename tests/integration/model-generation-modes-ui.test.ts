import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRenderer,nextTick,ssrContextKey} from 'vue';
import {createPinia,setActivePinia} from 'pinia';
import ModelTools from '../../apps/desktop/src/ModelTools.vue';
import {useSession} from '../../apps/desktop/src/store';
import {setLocale} from '../../apps/desktop/src/localization';
import {modelRecordName} from '../../apps/desktop/src/modules/model-labels';
import {speciesDefaults} from '../../packages/body/defaults';
import {project} from '../fixtures';
import {acceptedCutProject} from '../fixtures/accepted-cut';

beforeEach(()=>{setLocale('en');const events=new EventTarget();vi.stubGlobal('window',{dispatchEvent:events.dispatchEvent.bind(events)});});
afterEach(()=>{setLocale('en');vi.unstubAllGlobals();});
function mounted(){
 const pinia=createPinia();setActivePinia(pinia);const store=useSession();store.data.project=project();
 const renderer=createRenderer<any,any>({createComment:()=>({}),createElement:()=>({}),createText:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){},insert(){},remove(){}});
 const app=renderer.createApp({...ModelTools,render:()=>null},{language:'zh'});app.use(pinia);app.provide(ssrContextKey,{modules:new Set()});const vm=app.mount({});
 return {app,store,state:(vm as any).$.setupState};
}
const wearerKeys=['heightMm','neckGirthMm','chestGirthMm','waistGirthMm','hipGirthMm','shoulderWidthMm','armLengthMm','legLengthMm','upperArmGirthMm','forearmGirthMm','thighGirthMm','shinGirthMm','footLengthMm','paddingMm','hipPaddingMm','thighPaddingMm','calfPaddingMm','layerMm'] as const;

it('starts the new form in padded mode and sends one wearer recipe with its original project revision',async()=>{
 const ui=mounted();try{
  expect(ui.state.bodyMode).toBe('padded');expect(ui.state.speciesParams.chestGirthMm).toBe(1000);
  ui.state.speciesParams.chestGirthMm=1075;ui.state.speciesParams.thighPaddingMm=42;
  const generateSpecies=vi.fn(async()=>({ok:true,data:JSON.parse(JSON.stringify(ui.store.data))}));window.fpcad={generateSpecies} as unknown as typeof window.fpcad;
  await ui.state.generateTemplate();expect(generateSpecies).toHaveBeenCalledTimes(1);expect(generateSpecies.mock.calls[0]).toEqual([ui.store.data.project!.id,ui.store.data.project!.revision,expect.objectContaining({bodyMode:'padded',chestGirthMm:1075,thighPaddingMm:42})]);
 }finally{ui.app.unmount();}
});
it('keeps every wearer dimension and padding edit when changing species',()=>{
 const ui=mounted();try{
  Object.assign(ui.state.speciesParams,{heightMm:1900,neckGirthMm:390,chestGirthMm:1085,waistGirthMm:875,hipGirthMm:1025,shoulderWidthMm:490,armLengthMm:615,legLengthMm:800,upperArmGirthMm:410,forearmGirthMm:320,thighGirthMm:610,shinGirthMm:395,footLengthMm:285,hipPaddingMm:11,thighPaddingMm:23,calfPaddingMm:7,paddingMm:9,layerMm:3});
  const before=Object.fromEntries(wearerKeys.map(key=>[key,ui.state.speciesParams[key]]));
  for(const species of ['rabbit','bear','dragon','deer','feline','canine']){ui.state.setSpecies(species);expect(Object.fromEntries(wearerKeys.map(key=>[key,ui.state.speciesParams[key]]))).toEqual(before);expect(ui.state.bodyMode).toBe('padded');expect(ui.state.speciesParams.species).toBe(species);}
 }finally{ui.app.unmount();}
});
it('uses local padding fields for wearer modes, keeps valid appearance drafts and disables DTD material application',()=>{
 const ui=mounted();try{
  ui.state.setBodyMode('costume');Object.assign(ui.state.speciesParams,{earHeightMm:211,tailLengthMm:777,layerMm:4});
  ui.store.data.project!.materials=[{id:'material',name:'test',compensationMm:12}] as any;ui.state.layerMaterial='material';
  const before=Object.fromEntries(wearerKeys.map(key=>[key,ui.state.speciesParams[key]]));
  ui.state.setBodyMode('dtd');ui.state.useMaterialLayer();expect(Object.fromEntries(wearerKeys.map(key=>[key,ui.state.speciesParams[key]]))).toEqual(before);
  for(const mode of ['dtd','padded']){ui.state.setBodyMode(mode);const keys=ui.state.speciesGroups.flatMap((g:any)=>g.keys);expect(keys).toContain('hipPaddingMm');expect(keys).toContain('thighPaddingMm');expect(keys).toContain('calfPaddingMm');for(const hidden of ['paddingMm','earHeightMm','tailLengthMm','pawLengthMm','clawLengthMm'])expect(keys).not.toContain(hidden);}
  ui.state.setBodyMode('costume');expect(ui.state.speciesParams.earHeightMm).toBe(211);expect(ui.state.speciesParams.tailLengthMm).toBe(777);expect(ui.state.speciesGroups.flatMap((g:any)=>g.keys)).toContain('paddingMm');
 }finally{ui.app.unmount();}
});
it('repairs invalid hidden appearance fields on entering a wearer mode without changing wearer edits',()=>{
 const ui=mounted();try{
  ui.state.setBodyMode('costume');Object.assign(ui.state.speciesParams,{earHeightMm:0,snoutLengthMm:NaN,tailBaseGirthMm:100,tailTipGirthMm:200,chestGirthMm:1125,thighPaddingMm:37});ui.state.setBodyMode('padded');
  expect(ui.state.speciesValid).toBe(true);expect(ui.state.speciesParams.earHeightMm).toBe(speciesDefaults('canine','padded').earHeightMm);expect(ui.state.speciesParams.snoutLengthMm).toBe(speciesDefaults('canine','padded').snoutLengthMm);expect(ui.state.speciesParams.tailTipGirthMm).toBeLessThanOrEqual(ui.state.speciesParams.tailBaseGirthMm);expect(ui.state.speciesParams.chestGirthMm).toBe(1125);expect(ui.state.speciesParams.thighPaddingMm).toBe(37);
 }finally{ui.app.unmount();}
});
it('loads an old recipe without bodyMode as costume without converting its dimensions',async()=>{
 const ui=mounted();try{
  const parameters=speciesDefaults('bear');delete parameters.bodyMode;parameters.chestGirthMm=1425;const surface=acceptedCutProject().surface!;surface.template={id:'original-bear-plantigrade',version:'1.1.0',license:'original-project-source',parameters,parts:[],measurements:[],warnings:[]};ui.store.data.project!.surface=surface;await nextTick();
  expect(ui.state.bodyMode).toBe('costume');expect(ui.state.speciesParams).toEqual(parameters);expect(ui.state.speciesParams.chestGirthMm).toBe(1425);
 }finally{ui.app.unmount();}
});
it('labels default DTD, padded and costume models distinctly while preserving custom names and legacy naming',()=>{
 const shape=(bodyMode?:'dtd'|'padded'|'costume')=>({template:{id:'recipe',parameters:{species:'canine',legType:'digitigrade',bodyMode}}});
 expect(modelRecordName('recipe',shape('dtd'),true)).toBe('DTD 人体基体');expect(modelRecordName('recipe',shape('padded'),true)).toBe('一体填充外形');expect(modelRecordName('recipe',shape('costume'),true)).toContain('兽装外形');expect(modelRecordName('recipe',shape(),true)).toBe('犬科 · 趾行腿');
 for(const mode of ['dtd','padded','costume'] as const)expect(modelRecordName('Custom wearer 7',shape(mode),true)).toBe('Custom wearer 7');
 setLocale('ja');expect(modelRecordName('recipe',shape('dtd'),false)).toBe('DTD 人体ベース');expect(modelRecordName('recipe',shape('padded'),false)).toBe('一体型パディング外形');
});

import {expect,it} from 'vitest';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import type {Reference} from '../../packages/schema/index';
import {project} from '../fixtures';

it('saved original-JPEG vectors retain all eight independently selected tail/thigh material landmarks',async()=>{
 const references:Reference[]=[];
 for(const [view,left,width]of [['front',609,666],['back',0,609]] as const){
  const {data,info}=await sharp('tests/fixtures/character-front-back.jpg').extract({left,top:0,width,height:750}).png().toBuffer({resolveWithObject:true});
  references.push({id:randomUUID(),name:view,view,width:info.width,height:info.height,png:'data:image/png;base64,'+data.toString('base64'),resources:{} as Reference['resources']});
 }
 const split=splitReferences(references,1800,8,true),p={...project(),pieces:[],references:split.references,patternLibrary:split.regions};
 // The oracle evaluates original JPEG RGB and saved cubic vectors itself; it
 // imports no production classifier, rasterizer, contour fitter or ownership.
 const {assertCharacterSeparation}=await import(pathToFileURL(resolve('tests/fixtures/character-functional-oracle.mjs')).href),evidence=await assertCharacterSeparation(p);
 expect(evidence.landmarks).toHaveLength(8);
 mkdirSync('test-results/2026-10-25-pattern-quality',{recursive:true});
 writeFileSync('test-results/2026-10-25-pattern-quality/group2-character-landmarks.json',JSON.stringify(evidence,null,2));
},120000);

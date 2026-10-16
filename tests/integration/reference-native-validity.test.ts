import {it,expect} from 'vitest';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {splitReferences} from '../../apps/desktop/main/automatic-reference';
import {analyze} from '../../apps/desktop/main/worker';
import type {Reference} from '../../packages/schema/index';
import {project} from '../fixtures';

it.each([.5,.8,1.2])('original-image variants at scale %s retain native-valid editable contours',async(scale)=>{
 const references:Reference[]=[];
 for(const [view,left,width] of [['front',609,666],['back',0,609]] as const){const {data,info}=await sharp('tests/fixtures/character-front-back.jpg').extract({left,top:0,width,height:750}).resize({width:Math.round(width*scale),height:Math.round(750*scale)}).png().toBuffer({resolveWithObject:true});references.push({id:randomUUID(),name:view,view,width:info.width,height:info.height,png:'data:image/png;base64,'+data.toString('base64'),resources:{} as Reference['resources']});}
 const result=splitReferences(references,1800,6,true),p=project();p.pieces=result.regions.map(r=>r.piece);const geometry=await analyze(resolve('target/release/fpcad-worker.exe'),p);expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error').map(i=>({piece:p.pieces.find(p=>p.id===g.id)?.name,...i})))).toEqual([]);
},120000);

it('the second actual blue-white character produces native-valid contours',async()=>{
 const references:Reference[]=[];
 // Actual off-centre gutter detected by the upload's 512px proxy.
 for(const [view,left,width] of [['front',0,803],['back',803,733]] as const){const {data,info}=await sharp('tests/fixtures/character-blue-white-front-back.png').extract({left,top:0,width,height:1024}).png().toBuffer({resolveWithObject:true});references.push({id:randomUUID(),name:view,view,width:info.width,height:info.height,png:'data:image/png;base64,'+data.toString('base64'),resources:{} as Reference['resources']});}
 const result=splitReferences(references,1800,6,true),p=project();p.pieces=result.regions.map(r=>r.piece);const geometry=await analyze(resolve('target/release/fpcad-worker.exe'),p);expect(geometry.flatMap(g=>g.issues.filter(i=>i.severity==='error').map(i=>({piece:p.pieces.find(p=>p.id===g.id)?.name,color:p.pieces.find(p=>p.id===g.id)?.color,...i})))).toEqual([]);
},120000);

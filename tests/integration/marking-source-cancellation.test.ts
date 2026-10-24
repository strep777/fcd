import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {project} from '../fixtures';
import {parseObj,pieceGeometryHash} from '../../apps/desktop/main/surface';
import {hash} from '../../apps/desktop/main/repository';
import {editMarkingSource} from '../../apps/desktop/main/markings';
import {refreshSavedModelMarkings} from '../../apps/desktop/main/model-markings';
import type {Marking} from '../../packages/schema/index';

const mesh='v 0 0 0\nv 300 0 0\nv 300 300 0\nv 0 300 0\nf 1 2 3\nf 1 3 4';
function fixture(){const p=project(),source=p.pieces[0];p.surface=parseObj(mesh);const marking:Marking={id:randomUUID(),name:'Source attachment',color:source.color,source:'reference',editMode:'projected',sourcePieceId:source.id,sourceHash:pieceGeometryHash(source),surfaceId:p.surface.id,topologyVersion:p.surface.topologyVersion,surfaceHash:hash(JSON.stringify(p.surface)),view:'front',offsetXmm:0,offsetYmm:0,fragments:[],paths:[]};p.markings=[marking];return {p,source,marking};}

it.each([false,true])('source editing preserves the full project when cancellation happens beforeStartup=%s',async beforeStartup=>{
 const {p,source}=fixture(),before=structuredClone(p),controller=new AbortController();if(beforeStartup)controller.abort();
 const pending=editMarkingSource(resolve('missing-cancel-test-worker.exe'),p,source.id,source.nodes[0].id,1,2,false,controller.signal);controller.abort();
 await expect(pending).rejects.toThrow('CANCELLED');expect(p).toEqual(before);
});

it.each([false,true])('inactive model refresh carries cancellation to native startup beforeStartup=%s and retains every snapshot',async beforeStartup=>{
 const {p,source,marking}=fixture(),surface=parseObj(mesh);p.modelLibrary=[{id:surface.id,name:'Inactive model',surface,markings:[{...marking,surfaceId:surface.id,surfaceHash:hash(JSON.stringify(surface))}]}];
 const before=structuredClone(p),controller=new AbortController();if(beforeStartup)controller.abort();
 const pending=refreshSavedModelMarkings(resolve('missing-cancel-test-worker.exe'),p,source.id,false,false,controller.signal);controller.abort();
 await expect(pending).rejects.toThrow('CANCELLED');expect(p).toEqual(before);
});

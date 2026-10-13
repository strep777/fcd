import {archiveCut,activateCut,archivedPlacementMatches} from './cutting-library';
import {resizeProject} from './resize-project';
import {mapPiece} from '../../../packages/pattern/edit';
import {placementMatchesModel} from '../../../packages/reference/placement-review';
import {cutColorHash} from './surface';
import {staleMarkingIds,markingFingerprint} from './markings';
import {workflowNodes} from '../../../packages/workflow/nodes';
import {materialInUse} from '../../../packages/manufacturing/dependencies';
import {assertModelDetach,assertSeamEdit,detachCutPaths,deleteMarking,saveActiveModel} from './project-lifecycle';
import {referenceKey} from '../../../packages/reference/resources';
import {trimPath,joinPaths,remapPathSeams} from '../../../packages/pattern/path-operations';
import {splitProjectEdge} from './topology-edit';
import {rebaseAnatomyInferences} from './anatomy-inference';
import {applyModelAnatomy} from './model-anatomy';
import {cutCandidateInputHash} from './cut-candidate';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { projectSchema,surfaceSchema,parseProject, type Project, type Command } from '../../../packages/schema/index';
export class DomainError extends Error {constructor(public code:string){super(code);}}
export const hash=(data:string|Uint8Array)=>createHash('sha256').update(data).digest('hex');
export class Repository {
  db:DatabaseSync;
  startupNotice?:'PROJECT_INVALID';
  maintenanceWarning?:'STORAGE_RECLAIM_FAILED';
  constructor(path:string){
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, state TEXT NOT NULL, saved_revision INTEGER, destination TEXT, cursor INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS resources(digest TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands(session_id TEXT REFERENCES sessions(id), sequence INTEGER, before_state TEXT NOT NULL, after_state TEXT NOT NULL, type TEXT NOT NULL, PRIMARY KEY(session_id,sequence));
      CREATE TABLE IF NOT EXISTS events(session_id TEXT REFERENCES sessions(id),revision INTEGER,type TEXT,PRIMARY KEY(session_id,revision));
      CREATE TABLE IF NOT EXISTS recovery(session_id TEXT REFERENCES sessions(id),revision INTEGER,state TEXT NOT NULL,checksum TEXT NOT NULL,PRIMARY KEY(session_id,revision));
      CREATE TABLE IF NOT EXISTS requests(session_id TEXT REFERENCES sessions(id),request_id TEXT, fingerprint TEXT, response TEXT, PRIMARY KEY(session_id,request_id));`);
    const result=this.db.prepare('PRAGMA integrity_check').get();
    if(result?.integrity_check!=='ok')throw new DomainError('DATABASE_INTEGRITY');
    const active=this.row();if(active)try{this.readState(String(active.state));}catch{
      // Preserve the damaged session and all recovery/history records; only detach its active pointer.
      this.db.prepare("DELETE FROM settings WHERE key='active'").run();this.startupNotice='PROJECT_INVALID';
    }
  }
  transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  get sessionId():string|null{return this.db.prepare("SELECT value FROM settings WHERE key='active'").get()?.value as string ?? null;}
  row(){const id=this.sessionId;return id?this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id):undefined;}
  snapshot():Project|null{const row=this.row();return row?this.readState(row.state as string):null;}
  private storeResource(value:unknown){const json=JSON.stringify(value),digest=hash(json);this.db.prepare('INSERT OR IGNORE INTO resources(digest,json) VALUES(?,?)').run(digest,json);return 'sqlite-resource:'+digest;}
  private readResource(value:unknown):unknown{if(typeof value!=='string'||!value.startsWith('sqlite-resource:'))return value;if(!/^sqlite-resource:[a-f0-9]{64}$/.test(value))throw new DomainError('RESOURCE_INTEGRITY');const digest=value.slice(16),row=this.db.prepare('SELECT json FROM resources WHERE digest=?').get(digest);if(!row||hash(row.json as string)!==digest)throw new DomainError('RESOURCE_INTEGRITY');return JSON.parse(row.json as string);}
  private storeState(project:Project){const image=(r:NonNullable<Project['references']>[number])=>({...r,...(r.sheet?.png?{sheet:{...r.sheet,png:this.storeResource(r.sheet.png)}}:{}),png:this.storeResource(r.png),...(r.resources?{resources:{...r.resources,source:{...r.resources.source,data:this.storeResource(r.resources.source.data)},proxy:{...r.resources.proxy,png:this.storeResource(r.resources.proxy.png)},thumbnail:{...r.resources.thumbnail,png:this.storeResource(r.resources.thumbnail.png)}}}:{})});return JSON.stringify({...project,...(project.surface?{surface:this.storeResource(project.surface)}:{}),...(project.cuttingLibrary?{cuttingLibrary:project.cuttingLibrary.map(e=>({...e,surface:this.storeResource(e.surface),run:this.storeResource(e.run),markings:this.storeResource(e.markings)}))}:{}),...(project.modelLibrary?{modelLibrary:project.modelLibrary.map(m=>({...m,surface:this.storeResource(m.surface)}))}:{}),...(project.references?{references:project.references.map(image)}:{})});}
  private readState(state:string):Project{const resources=new Map<string,unknown>(),resource=(value:unknown)=>{if(typeof value==='string'&&value.startsWith('sqlite-resource:')){if(resources.has(value))return resources.get(value);const r=this.readResource(value);resources.set(value,r);return r;}return this.readResource(value);};const p=JSON.parse(state);p.surface=resource(p.surface);if(p.cuttingLibrary)p.cuttingLibrary=p.cuttingLibrary.map((e:Record<string,unknown>)=>({...e,surface:resource(e.surface),run:resource(e.run),markings:resource(e.markings)}));if(p.modelLibrary)p.modelLibrary=p.modelLibrary.map((m:Record<string,unknown>)=>({...m,surface:resource(m.surface)}));if(p.references)p.references=p.references.map((r:NonNullable<Project['references']>[number])=>({...r,...(r.sheet?.png?{sheet:{...r.sheet,png:resource(r.sheet.png)}}:{}),png:resource(r.png),...(r.resources?{resources:{...r.resources,source:{...r.resources.source,data:resource(r.resources.source.data)},proxy:{...r.resources.proxy,png:resource(r.resources.proxy.png)},thumbnail:{...r.resources.thumbnail,png:resource(r.resources.thumbnail.png)}}}:{})}));return parseProject(p);}
  activate(id:string){const target=this.db.prepare('SELECT state FROM sessions WHERE id=?').get(id);if(!target)throw new DomainError('PROJECT_MISSING');try{this.readState(String(target.state));}catch{throw new DomainError('PROJECT_INVALID');}this.db.prepare("INSERT OR REPLACE INTO settings VALUES('active',?)").run(id);this.startupNotice=undefined;}
  recent(){return this.db.prepare("SELECT id,json_extract(state,'$.name') AS name,json_extract(state,'$.revision') AS revision FROM sessions WHERE json_valid(state) ORDER BY rowid DESC LIMIT 100").all().map(r=>({sessionId:String(r.id),name:String(r.name),revision:Number(r.revision)}));}
  /** Delete local state atomically; externally saved project files are never touched. */
  deleteSession(sessionId:string):boolean{
    const deleted=this.transaction(()=>{
      const exists=!!this.db.prepare('SELECT 1 FROM sessions WHERE id=?').get(sessionId);
      this.db.prepare("DELETE FROM settings WHERE key='active' AND value=?").run(sessionId);
      if(!exists)return false;
      const hasJobs=!!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").get();
      if(hasJobs)this.db.prepare('DELETE FROM jobs WHERE session_id=?').run(sessionId);
      for(const table of ['commands','events','recovery','requests'])this.db.prepare(`DELETE FROM ${table} WHERE session_id=?`).run(sessionId);
      this.db.prepare('DELETE FROM sessions WHERE id=?').run(sessionId);
      const retained=new Set<string>(),pending:string[]=[];
      const scan=(json:string)=>{
        let value:unknown;try{value=JSON.parse(json);}catch{throw new DomainError('DATABASE_INTEGRITY');}
        const values:unknown[]=[value];
        while(values.length){const current=values.pop();if(typeof current==='string'&&current.startsWith('sqlite-resource:')){
          if(!/^sqlite-resource:[a-f0-9]{64}$/.test(current))throw new DomainError('RESOURCE_INTEGRITY');
          const digest=current.slice(16);if(!retained.has(digest)){retained.add(digest);pending.push(digest);}
        }else if(Array.isArray(current)){for(const child of current)values.push(child);}else if(current&&typeof current==='object'){for(const child of Object.values(current))values.push(child);}}
      };
      // Every project snapshot, including undo and replay records, is a GC root.
      // Refuse collection when any surviving snapshot cannot be read reliably.
      for(const row of this.db.prepare('SELECT state AS json FROM sessions UNION ALL SELECT before_state FROM commands UNION ALL SELECT after_state FROM commands UNION ALL SELECT state FROM recovery UNION ALL SELECT response FROM requests').iterate()){
        try{this.readState(String(row.json));}catch{throw new DomainError('DATABASE_INTEGRITY');}
        scan(String(row.json));
      }
      if(hasJobs)for(const row of this.db.prepare('SELECT record FROM jobs').iterate())scan(String(row.record));
      const resource=this.db.prepare('SELECT json FROM resources WHERE digest=?');
      while(pending.length){const digest=pending.pop()!,row=resource.get(digest);if(!row||hash(String(row.json))!==digest)throw new DomainError('RESOURCE_INTEGRITY');scan(String(row.json));}
      const remove=this.db.prepare('DELETE FROM resources WHERE digest=?');
      for(const row of this.db.prepare('SELECT digest FROM resources').all())if(!retained.has(String(row.digest)))remove.run(row.digest);
      return true;
    });
    if(deleted)this.startupNotice=undefined;
    // VACUUM cannot run inside a transaction. A maintenance failure must not
    // report the already committed deletion as failed; retrying also retries cleanup.
    try{
      const checkpoint=()=>{if(Number(this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()?.busy)>0)throw new Error('WAL_BUSY');};
      checkpoint();this.db.exec('VACUUM');checkpoint();this.maintenanceWarning=undefined;
    }catch{this.maintenanceWarning='STORAGE_RECLAIM_FAILED';}
    return deleted;
  }
  create(name:string){const now=new Date().toISOString();return this.open({schemaVersion:2,id:randomUUID(),name,unit:'mm',revision:0,createdAt:now,updatedAt:now,pieces:[]},null);}
  open(project:Project,destination:string|null){
    const parsed=projectSchema.parse(project),sid=randomUUID();
    this.transaction(()=>{this.db.prepare('INSERT INTO sessions(id,state,saved_revision,destination) VALUES(?,?,?,?)').run(sid,this.storeState(parsed),destination?parsed.revision:null,destination);this.db.prepare("INSERT OR REPLACE INTO settings VALUES('active',?)").run(sid);this.checkpointWithinTransaction();});
    this.startupNotice=undefined;return parsed;
  }
  assertRevision(id:string,revision:number){const p=this.db.prepare("SELECT json_extract(state,'$.id') AS projectId,json_extract(state,'$.revision') AS revision FROM sessions WHERE id=?").get(this.sessionId??'');if(!p||p.projectId!==id)throw new DomainError('PROJECT_MISMATCH');if(p.revision!==revision)throw new DomainError('REVISION_CONFLICT');}
  commit(command:Command,requestId:string,fingerprint:string,withinTransaction?:()=>void){
    return this.transaction(()=>{
      const before=this.snapshot();if(!before)throw new DomainError('PROJECT_MISSING');const after=structuredClone(before);
      saveActiveModel(after);
      const pruneSources=(sourceIds:string[])=>{const filter=(markings:Project['markings'])=>{const removed=new Set(markings?.filter(m=>sourceIds.includes(m.sourcePieceId??'')).map(m=>m.id));let count=-1;while(count!==removed.size){count=removed.size;for(const m of markings??[])if(m.inference&&removed.has(m.inference.sourceMarkingId))removed.add(m.id);}if(markings?.some(m=>m.locked&&removed.has(m.id)))throw new DomainError('MARKING_LOCKED');return markings?.filter(m=>!removed.has(m.id));};after.markings=filter(after.markings);after.modelLibrary=after.modelLibrary?.map(model=>({...model,markings:filter(model.markings)}));if(after.referenceRun?.accepted&&(after.referenceRun.pieces??[after.referenceRun.piece]).some(p=>sourceIds.includes(p.id)))after.referenceRun=undefined;};
      if(command.type==='library.regions'){
        const removed=(after.patternLibrary??[]).filter(r=>command.replaceViews.includes(r.view)).map(r=>r.piece.id);
        if(after.markings?.some(m=>m.locked&&removed.includes(m.sourcePieceId??'')))throw new DomainError('MARKING_LOCKED');
        after.patternLibrary=[...(after.patternLibrary??[]).filter(r=>!command.replaceViews.includes(r.view)),...command.regions];
        pruneSources(removed);
        if(command.references)after.references=command.references;
        after.referenceRun=undefined;after.previewMarkings=undefined;after.surfaceRun=undefined;
      }else if(command.type==='library.region.put'||command.type==='library.region.update'){
        if(after.markings?.some(m=>m.sourcePieceId===command.region.piece.id&&m.locked))throw new DomainError('MARKING_LOCKED');
        after.patternLibrary=[...(after.patternLibrary??[]).filter(r=>r.piece.id!==command.region.piece.id),command.region];if(command.type==='library.region.update'){after.pieces=after.pieces.map(p=>p.id===command.region.piece.id?command.region.piece:p);after.markings=after.markings?.map(m=>command.markings.find(n=>n.id===m.id)??m);if(command.models)after.modelLibrary=command.models;}
        after.surfaceRun=undefined;after.previewMarkings=undefined;
      }else if(command.type==='library.regions.delete'){
        if(command.pieceIds.some(id=>!after.patternLibrary?.some(r=>r.piece.id===id)))throw new DomainError('ENTITY_MISSING');
        pruneSources(command.pieceIds);
        after.patternLibrary=after.patternLibrary?.filter(r=>!command.pieceIds.includes(r.piece.id));
        after.surfaceRun=undefined;after.previewMarkings=undefined;
      }else if(command.type==='library.region.delete'){
        if(!after.patternLibrary?.some(r=>r.piece.id===command.pieceId))throw new DomainError('ENTITY_MISSING');
        const ids=after.markings?.filter(m=>m.sourcePieceId===command.pieceId).map(m=>m.id)??[];
        if(after.markings?.some(m=>ids.includes(m.id)&&m.locked))throw new DomainError('MARKING_LOCKED');
        after.patternLibrary=after.patternLibrary.filter(r=>r.piece.id!==command.pieceId);
        pruneSources([command.pieceId]);after.surfaceRun=undefined;after.previewMarkings=undefined;
      }else if(command.type==='markings.batch'){after.markings=[...(after.markings??[]).filter(m=>!command.markings.some(n=>n.id===m.id)),...command.markings];after.surfaceRun=undefined;after.previewMarkings=undefined;}
      else if(command.type==='marking.placement.review'){if(command.markingIds.some(id=>!after.markings?.some(m=>m.id===id&&m.placement)))throw new DomainError('ENTITY_MISSING');for(const m of after.markings??[])if(command.markingIds.includes(m.id)){if(m.locked)throw new DomainError('MARKING_LOCKED');if(command.reviewed&&!(m.source==='cut-library'?archivedPlacementMatches(after,m)&&!staleMarkingIds(after).has(m.id):placementMatchesModel(after,m)))throw new DomainError('STALE_PLACEMENT');m.placement!.reviewed=command.reviewed;}after.surfaceRun=undefined;after.previewMarkings=undefined;}
      else if(command.type==='surface.anatomy')applyModelAnatomy(after,command);
      else if(command.type==='workflow.node'){if(!workflowNodes(after).some(n=>n.key===command.node.key))throw new DomainError('ENTITY_MISSING');after.workflow=[...(after.workflow??[]).filter(n=>n.key!==command.node.key),command.node];}
      else if(command.type==='model.rename'){const model=after.modelLibrary?.find(m=>m.id===command.modelId);if(!model)throw new DomainError('ENTITY_MISSING');model.name=command.name;}
      else if(command.type==='model.activate'||command.type==='model.delete'){
        const model=after.modelLibrary?.find(m=>m.id===command.modelId);if(!model)throw new DomainError('ENTITY_MISSING');
        if(command.type==='model.activate'||after.surface?.id===model.id){
          const removed=new Set(after.bindings?.map(b=>b.pieceId));
          assertModelDetach(after,removed);
          after.pieces=after.pieces.filter(p=>!removed.has(p.id));after.seams=after.seams?.filter(s=>!removed.has(s.a.pieceId)&&!removed.has(s.b.pieceId));
          after.activeCutId=undefined;after.surface=command.type==='model.activate'?model.surface:undefined;
          after.bindings=command.type==='model.activate'?model.bindings??[]:[];
          after.markings=command.type==='model.activate'?model.markings??[]:[];
          if(command.type==='model.activate'){after.pieces.push(...model.pieces??[]);after.seams=[...(after.seams??[]),...(model.seams??[])];}
          after.surfaceRun=undefined;after.previewMarkings=undefined;after.nesting=undefined;
        }
        if(command.type==='model.delete')after.modelLibrary=after.modelLibrary?.filter(m=>m.id!==model.id);
      }else if(command.type==='project.allowance')after.defaultAllowanceMm=command.widthMm;
      else if(command.type==='material.put'){const list=after.materials??[],old=list.find(m=>m.id===command.material.id);if(old&&command.material.version!==old.version+1||!old&&command.material.version!==1)throw new DomainError('MATERIAL_VERSION');after.materials=[...list.filter(m=>m.id!==command.material.id),command.material];for(const piece of after.pieces)if(piece.materialId===command.material.id)piece.material=command.material.name;}
      else if(command.type==='material.delete'){if(materialInUse(after,command.materialId))throw new DomainError('MATERIAL_IN_USE');if(!after.materials?.some(m=>m.id===command.materialId))throw new DomainError('ENTITY_MISSING');after.materials=after.materials.filter(m=>m.id!==command.materialId);}
      else if(command.type==='marking.put'){const list=after.markings??[],i=list.findIndex(m=>m.id===command.marking.id);if(i<0)list.push(command.marking);else list[i]=command.marking;after.markings=list;}
      else if(command.type==='marking.source.update'){const old=after.pieces.find(p=>p.id===command.piece.id)??after.patternLibrary?.find(r=>r.piece.id===command.piece.id)?.piece;if(!old)throw new DomainError('ENTITY_MISSING');const related=after.markings?.filter(m=>m.sourcePieceId===old.id)??[];if(related.length!==command.markings.length||related.some(m=>!command.markings.some(n=>n.id===m.id&&n.sourcePieceId===old.id)))throw new DomainError('STALE_MARKING');after.pieces=after.pieces.map(p=>p.id===old.id?command.piece:p);after.patternLibrary=after.patternLibrary?.map(r=>r.piece.id===old.id?{...r,piece:command.piece}:r);after.markings=after.markings?.map(m=>command.markings.find(n=>n.id===m.id)??m);if(command.models)after.modelLibrary=command.models;}
      else if(command.type==='marking.review'){const m=after.markings?.find(m=>m.id===command.markingId);if(!m?.inference)throw new DomainError('ENTITY_MISSING');if(m.locked)throw new DomainError('MARKING_LOCKED');m.inference.reviewed=command.reviewed;}
      else if(command.type==='marking.lock'){const m=after.markings?.find(m=>m.id===command.markingId);if(!m)throw new DomainError('ENTITY_MISSING');m.locked=command.locked;}
      else if(command.type==='markings.lockAll'){
        if(!after.surface)throw new DomainError('SURFACE_MISSING');
        const markings=(after.markings??[]).filter(m=>m.surfaceId===after.surface!.id);
        if(!markings.length)throw new DomainError('ENTITY_MISSING');
        if(command.locked){
          const stale=staleMarkingIds(after);
          if(markings.some(m=>stale.has(m.id)))throw new DomainError('STALE_MARKING');
          // One final confirmation reviews and locks the complete inspected arrangement.
          for(const m of markings){if(m.placement)m.placement.reviewed=true;if(m.inference)m.inference.reviewed=true;}
          for(const m of markings)if(m.inference){const parent=markings.find(source=>source.id===m.inference!.sourceMarkingId);if(parent)m.inference.sourceFingerprint=markingFingerprint(parent);}
        }
        for(const m of markings)m.locked=command.locked;
        after.surfaceRun=undefined;after.previewMarkings=undefined;
      }
      else if(command.type==='markings.clear'){
        if(!after.surface)throw new DomainError('SURFACE_MISSING');
        after.markings=(after.markings??[]).filter(m=>m.surfaceId!==after.surface!.id);
        after.surfaceRun=undefined;after.previewMarkings=undefined;
      }
      else if(command.type==='marking.delete')deleteMarking(after,command.markingId);
      else if(command.type==='reference.put'){const list=after.references??[];const i=list.findIndex(r=>r.view===command.reference.view);if(i<0)list.push(command.reference);else list[i]=command.reference;after.references=list;}
      else if(command.type==='reference.calibrate'){const ref=after.references?.find(r=>r.id===command.referenceId);if(!ref)throw new DomainError('ENTITY_MISSING');const c=command.calibration;if([c.a,c.b].some(p=>p.x>ref.width||p.y>ref.height))throw new DomainError('INVALID_CALIBRATION');const old=ref.calibration;
        if(old&&JSON.stringify(old)!==JSON.stringify(c)){
          const ids=(after.patternLibrary??[]).filter(r=>r.referenceId===ref.id).map(r=>r.piece.id);pruneSources(ids);
          const ox=old.b.x-old.a.x,oy=old.b.y-old.a.y,nx=c.b.x-c.a.x,ny=c.b.y-c.a.y,f=c.distanceMm/(nx*nx+ny*ny);
          after.patternLibrary=after.patternLibrary?.map(r=>r.referenceId!==ref.id?r:{...r,piece:mapPiece(r.piece,p=>{const x=old.a.x+(-oy*p.xMm+ox*p.yMm)/old.distanceMm-c.a.x,y=old.a.y+(ox*p.xMm+oy*p.yMm)/old.distanceMm-c.a.y;return {xMm:(-ny*x+nx*y)*f,yMm:(nx*x+ny*y)*f};})});
          after.surfaceRun=undefined;after.previewMarkings=undefined;
        }
        ref.calibration=c;ref.calibrationMode='manual';if(after.referenceRun?.referenceId===ref.id)after.referenceRun=undefined;}
      else if(command.type==='reference.delete'){if(!after.references?.some(r=>r.id===command.referenceId))throw new DomainError('ENTITY_MISSING');after.references=after.references.filter(r=>r.id!==command.referenceId);}
      else if(command.type==='reference.masks.clean')after.maskSources=after.maskSources?.filter(s=>[...after.pieces,...(after.patternLibrary??[]).map(r=>r.piece),...(after.modelLibrary??[]).flatMap(m=>m.pieces??[])].some(p=>p.sourceMaskId===s.id));
      else if(command.type==='reference.candidate'||command.type==='reference.accept'){if(command.type==='reference.candidate')after.referenceRun=command.run;if(command.type==='reference.accept'||command.library!==undefined){const run=after.referenceRun,ref=after.references?.find(r=>r.id===run?.referenceId);if(!run||run.accepted||!ref||run.sourceHash!==hash(referenceKey(ref)))throw new DomainError('STALE_RESULT');const pieces=run.pieces??[run.piece];if(run.mask){if((after.maskSources?.length??0)>=20)throw new DomainError('MASK_SOURCE_LIMIT');const id=randomUUID();after.maskSources=[...(after.maskSources??[]),{id,referenceId:ref.id,sourceHash:run.sourceHash,mask:run.mask,algorithm:run.algorithm??'color-flood-1',...(run.clustering?{clustering:run.clustering}:{}),...(run.curveFit?{curveFit:run.curveFit}:{}),...(run.contourRepair?{contourRepair:run.contourRepair}:{}),...(run.discardedPixels?{discardedPixels:run.discardedPixels}:{}),calibration:ref.calibration!,originalWidth:ref.width,originalHeight:ref.height}];for(const piece of pieces)piece.sourceMaskId=id;}if(command.library)after.patternLibrary=[...(after.patternLibrary??[]),...pieces.map(piece=>({piece,referenceId:ref.id,view:ref.view,category:piece.color}))];else after.pieces.push(...pieces);run.accepted=true;}}
      else if(command.type==='surface.resize')resizeProject(after,command);
      else if(command.type==='surface.set'){
        const previous=after.surface,next=surfaceSchema.parse(command.surface);
        if(previous&&previous.id!==next.id){after.activeCutId=undefined;const removed=new Set(after.bindings?.map(b=>b.pieceId));assertModelDetach(after,removed);after.pieces=after.pieces.filter(p=>!removed.has(p.id));after.seams=after.seams?.filter(s=>!removed.has(s.a.pieceId)&&!removed.has(s.b.pieceId));after.bindings=[];after.markings=[];after.nesting=undefined;}
        if(previous?.id===next.id&&JSON.stringify(previous.vertices)===JSON.stringify(next.vertices)&&JSON.stringify(previous.faces.map(f=>[f.id,f.vertices]))===JSON.stringify(next.faces.map(f=>[f.id,f.vertices])))after.markings=after.markings?.map(m=>({...m,topologyVersion:next.topologyVersion,surfaceHash:hash(JSON.stringify(next))}));
        after.surface=next;after.surfaceRun=undefined;after.previewMarkings=undefined;
      }
      else if(command.type==='surface.split')throw new DomainError('FORBIDDEN');
      else if(command.type==='surface.refined'){
 const same=after.surface&&JSON.stringify([after.surface.vertices,after.surface.faces,after.surface.cutConstraints??[],after.surface.cutScope])===JSON.stringify([command.surface.vertices,command.surface.faces,command.surface.cutConstraints??[],command.surface.cutScope]);
 after.surface=surfaceSchema.parse(command.surface);after.markings=command.markings;if(same)for(const b of after.bindings??[]){b.surfaceHash=hash(JSON.stringify(after.surface));if(b.colorHash)b.colorHash=cutColorHash(after);}
 after.surfaceRun=undefined;after.previewMarkings=undefined;after.nesting=undefined;}

      else if(command.type==='cutting.activate')activateCut(after,command.entryId);
      else if(command.type==='cutting.delete'){if(after.activeCutId===command.entryId)throw new DomainError('CUT_LIBRARY_ACTIVE');if([...(after.markings??[]),...(after.modelLibrary??[]).flatMap(model=>model.markings??[])].some(m=>m.source==='cut-library'&&m.cutLibraryId===command.entryId))throw new DomainError('CUT_LIBRARY_DEPENDENCY');if(!after.cuttingLibrary?.some(e=>e.id===command.entryId))throw new DomainError('ENTITY_MISSING');after.cuttingLibrary=after.cuttingLibrary.filter(e=>e.id!==command.entryId);if(after.activeCutId===command.entryId)after.activeCutId=undefined;}
      else if(command.type==='unwrap.candidate'){after.surfaceRun={...command.run,inputHash:cutCandidateInputHash(after)};after.previewMarkings=command.markings;}
      else if(command.type==='unwrap.accept'){const run=after.surfaceRun;if(!run||run.accepted||!after.surface||run.sourceHash!==hash(JSON.stringify(after.surface))||run.inputHash!==cutCandidateInputHash(after))throw new DomainError('STALE_RESULT');const candidateMarkings=after.previewMarkings??after.markings??[];if(candidateMarkings.some(m=>m.placement&&!m.placement.reviewed))throw new DomainError('AUTOMATIC_PLACEMENT_REVIEW');if(candidateMarkings.some(m=>m.inference&&!m.inference.reviewed))throw new DomainError('INFERRED_MARKING_REVIEW');const removed=new Set(after.bindings?.filter(b=>b.surfaceId===after.surface!.id).map(b=>b.pieceId));
        if(after.seams?.some(s=>removed.has(s.a.pieceId)||removed.has(s.b.pieceId)))throw new DomainError('SEAM_DEPENDENCY');
        if(after.markings?.some(m=>m.locked&&m.paths.some(path=>removed.has(path.pieceId))))throw new DomainError('MARKING_LOCKED');
        after.pieces=after.pieces.filter(p=>!removed.has(p.id));after.seams=after.seams?.filter(s=>!removed.has(s.a.pieceId)&&!removed.has(s.b.pieceId));
        after.pieces.push(...run.pieces);after.bindings=[...(after.bindings??[]).filter(b=>!removed.has(b.pieceId)),...run.bindings];
        if(after.previewMarkings)after.markings=after.previewMarkings;after.previewMarkings=undefined;after.nesting=undefined;run.accepted=true;const entry=archiveCut(after);after.cuttingLibrary=[...(after.cuttingLibrary??[]),entry];after.activeCutId=entry.id;after.markings=after.markings?.map(m=>({...m,source:'cut-library',cutLibraryId:entry.id,cutLibrarySourceHash:m.sourceHash,sourcePieceId:undefined}));}
      else if(command.type==='seam.put'){const list=after.seams??[];const i=list.findIndex(s=>s.id===command.seam.id);assertSeamEdit(list[i],command.seam);if(i<0)list.push(command.seam);else list[i]=command.seam;after.seams=list;}
      else if(command.type==='seam.delete'){const seam=after.seams?.find(s=>s.id===command.seamId);if(!seam)throw new DomainError('ENTITY_MISSING');assertSeamEdit(seam);after.seams=after.seams!.filter(s=>s.id!==command.seamId);for(const p of after.pieces)if(p.notches)p.notches=p.notches.filter(n=>n.sourceSeamId!==command.seamId);}
      else if(command.type==='nesting.set')after.nesting=command.nesting;
      else if(command.type==='project.rename')after.name=command.name;
      else if(command.type==='piece.delete'){if(after.seams?.some(s=>s.a.pieceId===command.pieceId||s.b.pieceId===command.pieceId))throw new DomainError('SEAM_DEPENDENCY');if(!after.pieces.some(p=>p.id===command.pieceId))throw new DomainError('ENTITY_MISSING');pruneSources([command.pieceId]);detachCutPaths(after,new Set([command.pieceId]));after.pieces=after.pieces.filter(p=>p.id!==command.pieceId);}
      else if(command.type==='piece.trim'){const piece=after.pieces.find(p=>p.id===command.pieceId);if(!piece)throw new DomainError('ENTITY_MISSING');try{const result=trimPath(piece,command.startId,command.endId),pieces=after.pieces.map(p=>p.id===piece.id?result:p);after.seams=remapPathSeams(after,pieces);after.pieces=pieces;}catch(e){throw new DomainError(e instanceof Error?e.message:'INVALID_TRIM');}}
      else if(command.type==='piece.join'){const a=after.pieces.find(p=>p.id===command.a),b=after.pieces.find(p=>p.id===command.b);if(!a||!b)throw new DomainError('ENTITY_MISSING');try{const joined=joinPaths(a,b,command.reverseA,command.reverseB),pieces=after.pieces.filter(p=>p.id!==b.id).map(p=>p.id===a.id?joined:p),joinNode=(command.reverseA?a.nodes[0]:a.nodes.at(-1))!,removed=(command.reverseB?b.nodes.at(-1):b.nodes[0])!;after.seams=remapPathSeams(after,pieces,s=>{if(s.pieceId!==a.id&&s.pieceId!==b.id)return s;const reversed=s.pieceId===a.id?command.reverseA:command.reverseB;let side=reversed?{...s,nodeId:s.endNodeId,endNodeId:s.nodeId,start:1-s.end,end:1-s.start,reverse:!s.reverse}:s;if(side.pieceId===b.id)side={...side,pieceId:a.id,nodeId:side.nodeId===removed.id?joinNode.id:side.nodeId,endNodeId:side.endNodeId===removed.id?joinNode.id:side.endNodeId};return side;});after.pieces=pieces;}catch(e){throw new DomainError(e instanceof Error?e.message:'INVALID_JOIN');}}
      else if(command.type==='piece.adjusted'){after.pieces=after.pieces.map(p=>p.id===command.piece.id?command.piece:p);after.bindings=command.bindings;after.markings=command.markings;after.surfaceRun=undefined;after.previewMarkings=undefined;after.nesting=undefined;}
      else if(command.type==='piece.split')Object.assign(after,splitProjectEdge(after,command.pieceId,command.nodeId,command.t));
      else if(command.type==='pieces.replace'){
        if(command.removeIds.some(id=>!after.pieces.some(p=>p.id===id)))throw new DomainError('ENTITY_MISSING');
        const pieces=[...after.pieces.filter(p=>!command.removeIds.includes(p.id)),...command.pieces];remapPathSeams(after,pieces);
        const removed=new Set(command.removeIds.filter(id=>!command.pieces.some(p=>p.id===id)));
        if(removed.size){if(after.bindings?.some(b=>removed.has(b.pieceId)))throw new DomainError('BOUND_PATTERN_OPERATION');pruneSources([...removed]);detachCutPaths(after,removed);}
        after.pieces=after.pieces.filter(p=>!command.removeIds.includes(p.id));after.pieces.push(...command.pieces);
        if(new Set(after.pieces.map(p=>p.id)).size!==after.pieces.length)throw new DomainError('DUPLICATE_ENTITY');
      }else if(command.type==='piece.put'){const i=after.pieces.findIndex(p=>p.id===command.piece.id);if(i<0)after.pieces.push(command.piece);else after.pieces[i]=command.piece;}else throw new DomainError('FORBIDDEN');
      for(const piece of after.pieces)if(piece.materialId){const material=after.materials?.find(m=>m.id===piece.materialId);if(!material)throw new DomainError('MATERIAL_MISSING');piece.material=material.name;}
      if(command.type==='surface.anatomy')rebaseAnatomyInferences(before,after);
      saveActiveModel(after);
      if(['marking.put','marking.delete','marking.source.update','marking.review'].includes(command.type)){after.surfaceRun=undefined;after.previewMarkings=undefined;}
      after.revision++;after.updatedAt=new Date().toISOString();projectSchema.parse(after);
      const sid=this.sessionId!,cursor=Number(this.row()!.cursor);
      this.db.prepare('DELETE FROM commands WHERE session_id=? AND sequence>?').run(sid,cursor);
      const beforeState=this.storeState(before),afterState=this.storeState(after);
      this.db.prepare('INSERT INTO commands VALUES(?,?,?,?,?)').run(sid,cursor+1,beforeState,afterState,command.type);
      this.write(after,command.type,cursor+1,afterState);
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(sid,requestId,fingerprint,afterState);
      withinTransaction?.();
      return after;
    });
  }
  replay(requestId:string,fingerprint:string){const sid=this.sessionId;if(!sid)return false;const r=this.db.prepare('SELECT * FROM requests WHERE session_id=? AND request_id=?').get(sid,requestId);if(!r)return false;if(r.fingerprint!==fingerprint)throw new DomainError('REQUEST_ID_REUSED');return true;}
  write(p:Project,type:string,cursor:number,state=this.storeState(p)){this.db.prepare('UPDATE sessions SET state=?,cursor=? WHERE id=?').run(state,cursor,this.sessionId!);this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(this.sessionId!,p.revision,type);}
  historyMove(redo:boolean,requestId?:string,fingerprint?:string){return this.transaction(()=>{
    const row=this.row();const current=this.snapshot();if(!row||!current)throw new DomainError('PROJECT_MISSING');
    const cursor=Number(row.cursor),seq=redo?cursor+1:cursor;
    const command=this.db.prepare('SELECT * FROM commands WHERE session_id=? AND sequence=?').get(this.sessionId!,seq);
    if(!command)throw new DomainError(redo?'NOTHING_TO_REDO':'NOTHING_TO_UNDO');
    const next=this.readState(command[redo?'after_state':'before_state'] as string);next.revision=current.revision+1;next.updatedAt=new Date().toISOString();
    const state=this.storeState(next);this.write(next,redo?'redo':'undo',redo?cursor+1:cursor-1,state);if(requestId)this.db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(this.sessionId!,requestId,fingerprint!,state);return next;
  });}
  checkpoint(){if(this.sessionId)this.transaction(()=>this.checkpointWithinTransaction());}
  checkpointWithinTransaction(){const p=this.snapshot();if(!p)return;const s=this.storeState(p);this.db.prepare('INSERT OR REPLACE INTO recovery VALUES(?,?,?,?)').run(this.sessionId!,p.revision,s,hash(s));this.db.prepare('DELETE FROM recovery WHERE session_id=? AND revision NOT IN (SELECT revision FROM recovery WHERE session_id=? ORDER BY revision DESC LIMIT 10)').run(this.sessionId!,this.sessionId!);}
  restore(revision:number){const r=this.db.prepare('SELECT * FROM recovery WHERE session_id=? AND revision=?').get(this.sessionId!,revision);if(!r||hash(r.state as string)!==r.checksum)throw new DomainError('RECOVERY_INVALID');const restored=this.readState(r.state as string);
    this.transaction(()=>{const current=this.snapshot()!;const cursor=Number(this.row()!.cursor);restored.revision=current.revision+1;restored.updatedAt=new Date().toISOString();this.db.prepare('DELETE FROM commands WHERE session_id=? AND sequence>?').run(this.sessionId!,cursor);this.db.prepare('INSERT INTO commands VALUES(?,?,?,?,?)').run(this.sessionId!,cursor+1,this.storeState(current),this.storeState(restored),'recovery.restore');this.write(restored,'recovery.restore',cursor+1);this.checkpointWithinTransaction();});
  }
  markSaved(destination:string,revision:number){this.db.prepare('UPDATE sessions SET destination=?,saved_revision=? WHERE id=?').run(destination,revision,this.sessionId!);}
  status(){const row=this.row();const sid=this.sessionId;return {canUndo:!!row&&Number(row.cursor)>0,canRedo:!!row&&!!this.db.prepare('SELECT 1 FROM commands WHERE session_id=? AND sequence=?').get(sid!,Number(row.cursor)+1),savedRevision:row?.saved_revision as number|null??null,recovery:sid?this.db.prepare('SELECT revision FROM recovery WHERE session_id=? ORDER BY revision DESC').all(sid).map(r=>Number(r.revision)):[],history:sid?this.db.prepare('SELECT revision,type FROM events WHERE session_id=? ORDER BY revision DESC LIMIT 30').all(sid).map(r=>({revision:Number(r.revision),type:String(r.type)})):[]};}
  close(){this.db.close();}
}


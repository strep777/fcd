import {resolvePiece} from '../../../packages/manufacturing/material';
import { randomUUID } from 'node:crypto';
import { pieceSchema,projectSchema,type Join,type Geometry,type JobStatus,type JobSummary,type Piece,type Project } from '../../../packages/schema/index';
import { DomainError,hash,Repository } from './repository';
const algorithmVersion='polygon-offset-4-variable-arc';
type Compute=(project:Project,signal:AbortSignal)=>Promise<Geometry[]>;
interface StoredJob {id:string;sessionId:string;projectId:string;piece:Piece;baseRevision:number;inputHash:string;status:JobStatus;sequence:number;resultHash:string|null;geometry:Geometry|null;errorCode:string|null;algorithmVersion:string;effectiveAllowanceMm?:number}
/** Candidates never mutate domain state. Acceptance shares the command transaction. */
export class JobManager {
 private controllers=new Map<string,AbortController>();
 private disposed=false;
 constructor(private repository:Repository,private compute:Compute,private changed:()=>void=()=>{},private storageError:()=>void=()=>{}){
  repository.db.exec('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,session_id TEXT REFERENCES sessions(id),request_id TEXT,fingerprint TEXT,record TEXT NOT NULL,UNIQUE(session_id,request_id));');
  for(const row of repository.db.prepare('SELECT record FROM jobs').all()){
   const job=JSON.parse(String(row.record)) as StoredJob;
   if(job.status==='succeeded'&&job.algorithmVersion!==algorithmVersion){job.status='stale';job.errorCode='ALGORITHM_CHANGED';job.sequence++;this.persist(job);}
   if(job.status==='running'||job.status==='queued'){job.status='failed';job.errorCode='WORKER_CRASH';job.sequence++;this.persist(job);}
  }
 }
 private persist(job:StoredJob){this.repository.db.prepare('UPDATE jobs SET record=? WHERE id=?').run(JSON.stringify(job),job.id);}
 private get(id:string){const row=this.repository.db.prepare('SELECT record FROM jobs WHERE id=?').get(id);if(!row)throw new DomainError('JOB_MISSING');return JSON.parse(String(row.record)) as StoredJob;}
 private owned(id:string){const job=this.get(id);if(job.sessionId!==this.repository.sessionId)throw new DomainError('PROJECT_MISMATCH');return job;}
 private currentRevision(sessionId:string){const row=this.repository.db.prepare("SELECT json_extract(state,'$.revision') AS revision FROM sessions WHERE id=?").get(sessionId);if(!row)throw new DomainError('PROJECT_MISSING');return Number(row.revision);}
 list():JobSummary[]{const sid=this.repository.sessionId;if(!sid)return [];const revision=this.currentRevision(sid);return this.repository.db.prepare('SELECT record FROM jobs WHERE session_id=? ORDER BY rowid DESC LIMIT 100').all(sid).map(row=>{
  const j=JSON.parse(String(row.record)) as StoredJob;if(j.status==='succeeded'&&j.baseRevision!==revision){j.status='stale';j.sequence++;this.persist(j);}
  return {id:j.id,pieceId:j.piece.id,pieceName:j.piece.name,distanceMm:j.effectiveAllowanceMm??j.piece.allowanceMm,baseRevision:j.baseRevision,status:j.status,sequence:j.sequence,resultHash:j.resultHash,errorCode:j.errorCode,issues:j.geometry?.issues??[]};
 });}
 submit(pieceId:string,distanceMm:number,requestId:string,fingerprint:string,join:Join="miter",overrides?:Pick<Piece,'edgeAllowances'|'allowanceSource'>){
  if(this.disposed)throw new DomainError('WORKER_CRASH');const sid=this.repository.sessionId;if(!sid)throw new DomainError('PROJECT_MISSING');
  const replay=this.repository.db.prepare('SELECT id,fingerprint FROM jobs WHERE session_id=? AND request_id=?').get(sid,requestId);if(replay){if(replay.fingerprint!==fingerprint)throw new DomainError('REQUEST_ID_REUSED');return String(replay.id);}
  if(this.controllers.size>=4||Number(this.repository.db.prepare('SELECT count(*) AS n FROM jobs WHERE session_id=?').get(sid)?.n)>=1000)throw new DomainError('RESOURCE_LIMIT');
  const project=this.repository.snapshot()!,source=project.pieces.find(p=>p.id===pieceId);if(!source)throw new DomainError('ENTITY_MISSING');
  const piece=pieceSchema.parse({...source,allowanceMm:distanceMm,allowanceSource:'piece',edgeAllowances:[],join,...overrides});
  const job:StoredJob={id:randomUUID(),sessionId:sid,projectId:project.id,piece,baseRevision:project.revision,inputHash:hash(JSON.stringify(source)),effectiveAllowanceMm:resolvePiece(project,piece).allowanceMm,status:'queued',sequence:0,resultHash:null,geometry:null,errorCode:null,algorithmVersion};
  this.repository.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(job.id,sid,requestId,fingerprint,JSON.stringify(job));
  const controller=new AbortController();this.controllers.set(job.id,controller);
  setImmediate(()=>{void this.execute(job.id,{...project,pieces:[piece]},controller).catch(()=>this.storageError());});
  return job.id;
 }
 releaseDeleted(){for(const [id,controller] of this.controllers){if(!this.repository.db.prepare('SELECT 1 FROM jobs WHERE id=?').get(id)){controller.abort();this.controllers.delete(id);}}}
 private exists(id:string){return !this.disposed&&!!this.repository.db.prepare('SELECT 1 FROM jobs WHERE id=?').get(id);}
 private async execute(id:string,project:Project,controller:AbortController){
  try{
   if(!this.exists(id))return;let job=this.get(id);if(job.status!=='queued'||this.disposed)return;
   job.status='running';job.sequence++;this.persist(job);this.changed();
   const result=await this.compute(project,controller.signal);
   if(!this.exists(id))return;job=this.get(id);if(job.status!=='running')return;
   const geometry=result[0];if(result.length!==1||!geometry||geometry.id!==job.piece.id)throw new DomainError('WORKER_PROTOCOL');
   job.geometry=geometry;job.resultHash=hash(JSON.stringify({piece:job.piece,geometry,algorithmVersion:job.algorithmVersion,inputHash:job.inputHash}));
   job.status=geometry.issues.some(i=>i.severity==='error')?'failed':this.currentRevision(job.sessionId)!==job.baseRevision?'stale':'succeeded';
   job.errorCode=job.status==='failed'?'INVALID_GEOMETRY':null;job.sequence++;this.persist(job);this.changed();
  }catch(error){if(!this.exists(id))return;const job=this.get(id);if(job.status==='running'||job.status==='queued'){job.status=controller.signal.aborted?'cancelled':'failed';job.errorCode=error instanceof DomainError?error.code:'WORKER_CRASH';job.sequence++;this.persist(job);this.changed();}}
  finally{this.controllers.delete(id);}
 }
 cancel(id:string){const job=this.owned(id);if(job.status==='queued'||job.status==='running'){job.status='cancelled';job.errorCode='CANCELLED';job.sequence++;this.persist(job);this.controllers.get(id)?.abort();this.changed();}return job.status;}
 discard(id:string){const job=this.owned(id);if(job.status==='accepted')throw new DomainError('RESULT_ALREADY_ACCEPTED');if(job.status==='discarded')return;if(job.status!=='succeeded'&&job.status!=='stale'&&job.status!=='failed'&&job.status!=='cancelled')throw new DomainError('JOB_NOT_FINISHED');job.status='discarded';job.geometry=null;job.sequence++;this.persist(job);this.changed();}
 accept(id:string,resultHash:string,requestId:string,fingerprint:string){const job=this.owned(id);if(job.resultHash!==resultHash)throw new DomainError('HASH_MISMATCH');if(job.status==='accepted')return;if(job.status!=='succeeded')throw new DomainError(job.status==='stale'?'STALE_RESULT':'JOB_NOT_SUCCEEDED');
  const project=this.repository.snapshot()!,source=project.pieces.find(p=>p.id===job.piece.id);
  if(project.revision!==job.baseRevision||!source||hash(JSON.stringify(source))!==job.inputHash){job.status='stale';job.sequence++;this.persist(job);throw new DomainError('STALE_RESULT');}
  const actual=hash(JSON.stringify({piece:job.piece,geometry:job.geometry,algorithmVersion:job.algorithmVersion,inputHash:job.inputHash}));
  if(actual!==resultHash||!job.geometry||job.geometry.issues.some(i=>i.severity==='error'))throw new DomainError('INVALID_GEOMETRY');
  this.repository.commit({type:'piece.put',piece:job.piece},requestId,fingerprint,()=>{job.status='accepted';job.sequence++;this.persist(job);this.repository.checkpointWithinTransaction();});this.changed();
 }
 dispose(){this.releaseDeleted();for(const [id,controller] of this.controllers){const job=this.get(id);if(job.status==='running'||job.status==='queued'){job.status='cancelled';job.errorCode='CANCELLED';job.sequence++;this.persist(job);}controller.abort();}this.disposed=true;this.controllers.clear();}
}

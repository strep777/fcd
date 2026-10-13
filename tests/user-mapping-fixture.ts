import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import type {Project} from '../packages/schema/index';
/** An optional acceptance fixture from this workstation. Source DB is opened
 * read-only and never passed to the application's writable Repository. */
export function userMappingFixture():Project|undefined{
 const path=resolve('.local/workspace/workspace.sqlite');if(!existsSync(path))return;
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  const hydrate=(value:unknown):any=>typeof value==='string'&&value.startsWith('sqlite-resource:')?hydrate(JSON.parse(String(db.prepare('SELECT json FROM resources WHERE digest=?').get(value.slice(16))!.json))):Array.isArray(value)?value.map(hydrate):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,v])=>[key,hydrate(v)])):value;
  const projects=db.prepare('SELECT state FROM sessions').all().map(row=>hydrate(JSON.parse(String(row.state))) as Project);
  return projects.filter(p=>p.patternLibrary?.length===84&&p.surface).sort((a,b)=>b.revision-a.revision||(b.surface!.faces.length-a.surface!.faces.length))[0];
 }finally{db.close();}
}

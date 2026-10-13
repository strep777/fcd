import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {requestSchema} from '../../packages/schema/index';

const pieces=Array.from({length:500},()=>randomUUID());
// Independent warnings on each piece exceed the old whole-project export
// limit while remaining within the same bounded budget used by pattern output.
const warnings=pieces.flatMap(id=>['distortion','allowance','curve-fit'].map(rule=>`${id}:${rule}`));
const paper={widthMm:210,heightMm:297,marginMm:10,overlapMm:10};
function request(method:string,payload:unknown){return {protocolVersion:1,requestId:randomUUID(),projectId:randomUUID(),expectedRevision:7,method,payload};}

it.each(['svg','pdf','png','dxf'])('a 500-piece project with several warnings per piece can request %s export',format=>{
 const parsed=requestSchema.safeParse(request('export.create',{format,warningAckIds:warnings}));
 expect(warnings).toHaveLength(1500);expect(parsed.success).toBe(true);
 if(parsed.success)expect(parsed.data.payload).toEqual({format,warningAckIds:warnings});
});

it.each(['patterns.output','patterns.preview','export.create'])('%s uses the same finite acknowledgement budget',method=>{
 const payload=method==='export.create'?{format:'svg'}:method==='patterns.output'?{pieceIds:pieces,paper,format:'svg'}:{pieceIds:pieces,paper};
 expect(requestSchema.safeParse(request(method,{...payload,warningAckIds:warnings})).success).toBe(true);
 const atLimit=Array.from({length:5000},(_,i)=>`${pieces[i%pieces.length]}:warning:${i}`);
 expect(requestSchema.safeParse(request(method,{...payload,warningAckIds:atLimit})).success).toBe(true);
 const overflow=requestSchema.safeParse(request(method,{...payload,warningAckIds:[...atLimit,'overflow']}));
 expect(overflow.success).toBe(false);
 if(!overflow.success)expect(overflow.error.issues).toContainEqual(expect.objectContaining({code:'too_big',path:['payload','warningAckIds'],maximum:5000}));
 expect(requestSchema.safeParse(request(method,{...payload,warningAckIds:[42]})).success).toBe(false);
});

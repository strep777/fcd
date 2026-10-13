import { it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requestSchema } from '../../packages/schema/index';
it('TC-006-b strict method-specific validation rejects arbitrary channels, paths and absent revision',()=>{const envelope={protocolVersion:1,requestId:randomUUID(),method:'session.read',payload:{}};expect(requestSchema.safeParse(envelope).success).toBe(true);expect(requestSchema.safeParse({...envelope,method:'shell.exec'}).success).toBe(false);expect(requestSchema.safeParse({...envelope,payload:{path:'C:/secret'}}).success).toBe(false);expect(requestSchema.safeParse({...envelope,method:'command.undo'}).success).toBe(false);});

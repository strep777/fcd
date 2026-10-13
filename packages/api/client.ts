import type {DesktopApi,Response,AssistantReply} from '../schema/index';
export type DesktopTransport={ [K in keyof DesktopApi]:DesktopApi[K] extends (...args:infer A)=>Promise<Response|AssistantReply>?(...args:A)=>Promise<string>:DesktopApi[K] };
/** The isolated preload exposes only approved methods. Parsing once avoids recursive bridge copies. */
export function desktopClient(transport:DesktopTransport):DesktopApi {
 const client=Object.fromEntries(Object.entries(transport).map(([key,fn])=>[key,key==='onChanged'||key==='onStorageError'?fn:async(...args:unknown[])=>{const raw=await (fn as (...args:unknown[])=>Promise<string>)(...args),response:unknown=JSON.parse(raw);if(!response||typeof response!=='object'||!('ok' in response)||typeof response.ok!=='boolean')throw Error('INVALID_RESPONSE');return response;} ]));
 return Object.freeze(client) as unknown as DesktopApi;
}

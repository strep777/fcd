import {afterEach,expect,it,vi} from 'vitest';
import {acquireImageUrl} from '../../apps/desktop/src/modules/image-url';

afterEach(()=>vi.restoreAllMocks());
it('shares full-resolution original bytes and releases the URL only after its last consumer',async()=>{
 const bytes=Uint8Array.from({length:96000},(_,i)=>i%256),source='data:image/png;base64,'+Buffer.from(bytes).toString('base64');
 let blob!:Blob;const create=vi.spyOn(URL,'createObjectURL').mockImplementation(value=>{blob=value as Blob;return 'blob:full-image';}),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const a=acquireImageUrl(source),b=acquireImageUrl(source);
 expect(a.url).toBe('blob:full-image');expect(b.url).toBe(a.url);expect(create).toHaveBeenCalledOnce();expect(blob.type).toBe('image/png');expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
 a.release();a.release();expect(revoke).not.toHaveBeenCalled();b.release();expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:full-image');
 const c=acquireImageUrl(source);expect(create).toHaveBeenCalledTimes(2);c.release();expect(revoke).toHaveBeenCalledTimes(2);
});
it('keeps small images and other source formats unchanged',()=>{
 const create=vi.spyOn(URL,'createObjectURL');
 for(const source of ['data:image/png;base64,AA==','data:image/svg+xml,'+'x'.repeat(65536),'blob:already-local']){const image=acquireImageUrl(source);expect(image.url).toBe(source);image.release();}
 expect(create).not.toHaveBeenCalled();
});

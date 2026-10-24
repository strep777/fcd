import type {Surface} from '../../../../packages/schema/index';

type Texture=NonNullable<Surface['textures']>[number];
export type TextureSource=Pick<Texture,'id'|'width'|'height'|'png'>&{proxy:Pick<Texture['proxy'],'width'|'height'|'png'>};

// Snapshot only decoder inputs; the image strings themselves are shared.
export function captureTextureSources(textures:readonly Texture[]=[]):TextureSource[]{return textures.map(texture=>({id:texture.id,width:texture.width,height:texture.height,png:texture.png,proxy:{width:texture.proxy.width,height:texture.proxy.height,png:texture.proxy.png}}));}
export function sameTextureSources(before:readonly TextureSource[]|undefined,after:readonly TextureSource[]){
 if(!before||before.length!==after.length)return false;
 const byId=new Map(after.map(texture=>[texture.id,texture]));if(byId.size!==after.length)return false;
 return before.every(texture=>{const next=byId.get(texture.id);return !!next&&texture.width===next.width&&texture.height===next.height&&texture.png===next.png&&texture.proxy.width===next.proxy.width&&texture.proxy.height===next.proxy.height&&texture.proxy.png===next.proxy.png;});
}

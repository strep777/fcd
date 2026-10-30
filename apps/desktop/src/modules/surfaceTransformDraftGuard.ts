import {computed,shallowRef} from 'vue';
type Owner={dirty:()=>boolean;prepare?:()=>void;save:()=>Promise<boolean>;discard:()=>void};
const owner=shallowRef<Owner>();
export const surfaceTransformsDirty=computed(()=>owner.value?.dirty()??false);
export const prepareSurfaceTransforms=()=>owner.value?.prepare?.();
export const saveSurfaceTransforms=async()=>{prepareSurfaceTransforms();return !surfaceTransformsDirty.value||await owner.value!.save();};
export const discardSurfaceTransforms=()=>owner.value?.discard();
export function registerSurfaceTransforms(value:Owner){owner.value=value;return ()=>{if(owner.value===value)owner.value=undefined;};}

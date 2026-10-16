import {rasterizePen} from '../../../packages/reference/pen-path';
self.onmessage=({data})=>{try{self.postMessage({ok:true,...rasterizePen(data.width,data.height,data.paths)});}catch(error){self.postMessage({ok:false,error:(error as Error).message});}};

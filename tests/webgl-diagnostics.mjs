/** Observe the app's existing WebGL contexts. Renderer strings describe the
 * WebView2/ANGLE context; they do not prove hardware acceleration or expose
 * Chromium's host-wide GPU feature status. No synthetic feature flags. */
export async function webglDiagnostics(page){
 return page.evaluate(()=>({
  source:'actual-application-webgl-contexts',
  scope:'Canvas context/driver observations only; not host GPU feature status or proof of hardware acceleration.',
  userAgent:navigator.userAgent,
  canvases:[...document.querySelectorAll('.surface-gpu .surface-canvas')].map(canvas=>{
   const rect=canvas.getBoundingClientRect(),base={width:canvas.width,height:canvas.height,backend:canvas.dataset.backend??null,visible:rect.width>0&&rect.height>0};
   const gl=canvas.getContext('webgl');
   if(!gl)return{...base,contextAvailable:false};
   const contextLost=gl.isContextLost();
   if(contextLost)return{...base,contextAvailable:true,contextLost:true};
   const extension=gl.getExtension('WEBGL_debug_renderer_info');
   return{...base,contextAvailable:true,contextLost:false,version:gl.getParameter(gl.VERSION),shadingLanguageVersion:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),contextAttributes:gl.getContextAttributes(),debugRendererExtensionAvailable:!!extension,unmaskedRenderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):null,unmaskedVendor:extension?gl.getParameter(extension.UNMASKED_VENDOR_WEBGL):null};
  })
 }));
}

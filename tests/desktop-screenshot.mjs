import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

/** Capture actual compositor pixels without exposing the Electron test window.
 * Accepts a Page or Locator, returns a Buffer like Playwright's screenshot, and
 * retains locator crops, explicit clips, full-page captures and output paths. */
export async function desktopScreenshot(app,target,options={}){
 const isPage=typeof target.viewportSize==='function',page=isPage?target:target.page(),win=await app.browserWindow(page),timeoutMs=options.timeout??15000;
 const supported=new Set(['path','clip','fullPage','timeout','type','quality','scale']);
 for(const key of Object.keys(options))if(!supported.has(key))throw Error('Unsupported hidden screenshot option: '+key);
 let timer,original,viewportChanged=false;
 const viewport=page.viewportSize(),scroll=await page.evaluate(()=>({x:scrollX,y:scrollY}));
 try{
  original=await win.evaluate(w=>{if(w.isVisible())throw Error('Test screenshot requires a hidden window');return {size:w.getContentSize(),throttling:w.webContents.getBackgroundThrottling()};});
  await win.evaluate(w=>w.webContents.setBackgroundThrottling(false));
  let size=await page.evaluate(()=>({width:innerWidth,height:innerHeight})),clip=options.clip;
  if(options.fullPage){size=await page.evaluate(()=>({width:Math.max(innerWidth,document.documentElement.scrollWidth,document.body?.scrollWidth??0),height:Math.max(innerHeight,document.documentElement.scrollHeight,document.body?.scrollHeight??0)}));}
  if(!isPage){await target.scrollIntoViewIfNeeded();let box=await target.boundingBox();if(!box||box.width<=0||box.height<=0)throw Error('Screenshot target has no visible bounds');size={width:Math.max(size.width,Math.ceil(box.width)),height:Math.max(size.height,Math.ceil(box.height))};}
  if(size.width*size.height>100000000||size.width>32767||size.height>32767)throw Error('Hidden screenshot exceeds pixel limits');
  // Match native content bounds to any Playwright viewport emulation; otherwise
  // capturePage may crop large emulated viewports or include unused window space.
  await win.evaluate((w,size)=>w.setContentSize(Math.ceil(size.width),Math.ceil(size.height)),size);
  if(options.fullPage||(!isPage&&(size.width!==(viewport?.width??original.size[0])||size.height!==(viewport?.height??original.size[1])))){await page.setViewportSize(size);viewportChanged=true;}
  if(options.fullPage)await page.evaluate(()=>scrollTo(0,0));
  if(!isPage){await target.scrollIntoViewIfNeeded();clip=await target.boundingBox();}
  const rect=clip?{x:Math.floor(clip.x),y:Math.floor(clip.y),width:Math.ceil(clip.x+clip.width)-Math.floor(clip.x),height:Math.ceil(clip.y+clip.height)-Math.floor(clip.y)}:{x:0,y:0,width:Math.ceil(size.width),height:Math.ceil(size.height)};
  if(!Object.values(rect).every(Number.isFinite)||rect.width<=0||rect.height<=0||rect.x<0||rect.y<0||rect.x+rect.width>size.width+1||rect.y+rect.height>size.height+1)throw Error('Screenshot clip lies outside the captured viewport');
  const operation=(async()=>{
   await page.evaluate(async()=>{await document.fonts.ready;await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));});
   const base64=await win.evaluate(async(w,{rect,type,quality,scale})=>{if(w.isVisible())throw Error('Test window must remain hidden');let image=await w.webContents.capturePage(rect,{stayHidden:true,stayAwake:true});if(w.isVisible())throw Error('Screenshot made test window visible');if(image.isEmpty())throw Error('Hidden native capture returned an empty image');if(scale==='css')image=image.resize({width:rect.width,height:rect.height});return (type==='jpeg'?image.toJPEG(quality??80):image.toPNG()).toString('base64');},{rect,type:options.type??(options.path?.match(/\.jpe?g$/i)?'jpeg':'png'),quality:options.quality,scale:options.scale});
   return Buffer.from(base64,'base64');
  })();
  const bytes=await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Hidden native screenshot timed out after '+timeoutMs+'ms')),timeoutMs);})]);
  if(options.path){await mkdir(dirname(options.path),{recursive:true});await writeFile(options.path,bytes);}return bytes;
 }finally{
  clearTimeout(timer);
  if(viewportChanged)await page.setViewportSize(viewport??{width:original.size[0],height:original.size[1]});
  if(original){await win.evaluate((w,state)=>{w.setContentSize(...state.size);w.webContents.setBackgroundThrottling(state.throttling);if(w.isVisible())throw Error('Screenshot cleanup exposed test window');},original);}
  await page.evaluate(({x,y})=>scrollTo(x,y),scroll);await win.dispose();
 }
}

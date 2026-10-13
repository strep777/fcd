/** Address the exact test page without depending on desktop focus or visibility. */
export async function hiddenWindowId(app,page){
 const handle=await app.browserWindow(page);
 try{return await handle.evaluate(window=>{if(window.isVisible())throw Error('Test window must remain hidden');return window.id;});}
 finally{await handle.dispose();}
}

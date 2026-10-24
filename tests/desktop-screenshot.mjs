/** Playwright captures WebView2 compositor pixels through the debug connection. */
export async function desktopScreenshot(_app,target,options={}){return target.screenshot(options);}

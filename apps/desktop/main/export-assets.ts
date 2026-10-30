import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
export const bundleFontPath='assets/FurryPatternSansSC-Regular.ttf';
let fontPath=resolve('assets/fonts/FurryPatternSansSC-Regular.ttf');
let wasmPath=resolve('dist/assets/resvg.wasm');
let font:Promise<Buffer>|undefined;
let fontBytes:Buffer|undefined;
export function configureExportAssets(directory:string){fontPath=join(directory,'fonts/FurryPatternSansSC-Regular.ttf');wasmPath=join(directory,'resvg.wasm');font=undefined;fontBytes=undefined;}
export function exportFont(){const path=fontPath;return font??=fontBytes?Promise.resolve(fontBytes):readFile(path).then(bytes=>{if(fontPath===path)fontBytes??=bytes;return bytes;});}
export function exportFontSync(){return fontBytes??=readFileSync(fontPath);}
export function exportWasm(){return readFile(wasmPath);}


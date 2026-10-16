import { readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
let fontPath=resolve('assets/fonts/FurryPatternSansSC-Regular.ttf');
let wasmPath=resolve('dist/assets/resvg.wasm');
let font:Promise<Buffer>|undefined;
export function configureExportAssets(directory:string){fontPath=join(directory,'fonts/FurryPatternSansSC-Regular.ttf');wasmPath=join(directory,'resvg.wasm');font=undefined;}
export function exportFont(){return font??=readFile(fontPath);}
export function exportWasm(){return readFile(wasmPath);}


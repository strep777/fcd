import {existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
/** Support both a local install and npm dependencies hoisted to an ancestor. */
export function installedPath(path){
 if(!path.startsWith('node_modules/')||path.split('/').includes('..'))throw Error('Invalid dependency path');
 let directory=resolve('.');for(;;){const candidate=join(directory,path);if(existsSync(candidate))return candidate;const parent=dirname(directory);if(parent===directory)throw Error('Missing installed dependency: '+path);directory=parent;}
}

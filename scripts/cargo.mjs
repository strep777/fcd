import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const roots=[resolve('.tools')],runtime=roots.find(root=>existsSync(resolve(root,'cargo/bin/cargo.exe')));
const local = runtime?resolve(runtime,'cargo/bin/cargo.exe'):'';
const env = {...process.env};
if (runtime) { env.CARGO_HOME=resolve(runtime,'cargo'); env.RUSTUP_HOME=resolve(runtime,'rustup'); }
const args=process.argv.slice(2);
const vendor=roots.map(root=>resolve(root,'vendor')).find(existsSync);
if(vendor && args[0]!=='fmt')args.unshift('--config','source.crates-io.replace-with="local-vendor"','--config',`source.local-vendor.directory="${vendor.replaceAll('\\','/')}"`);
const result = spawnSync(existsSync(local)?local:'cargo',args,{stdio:'inherit',env});
if(result.error) console.error(result.error.message);
process.exit(result.status ?? 1);

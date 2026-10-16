import { build } from 'esbuild';
await build({entryPoints:['scripts/generate-contracts.ts'],bundle:true,platform:'node',format:'esm',outfile:'.tools/generate-contracts.mjs'});
await import('../.tools/generate-contracts.mjs');

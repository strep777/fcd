// Development-only TLS adapter for Windows sandboxes where Schannel cannot acquire credentials.
// Node verifies the official registry's TLS certificates. Cargo still verifies crate checksums.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const port=18387;
const server=createServer(async(req,res)=>{try{
 const path=req.url??'/';
 if(path==='/index/config.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({dl:`http://127.0.0.1:${port}/crates/{crate}/{crate}-{version}.crate`,api:'https://crates.io'}));return;}
 const url=path.startsWith('/index/')?'https://index.crates.io/'+path.slice(7):path.startsWith('/crates/')?'https://static.crates.io'+path:null;
 if(!url){res.writeHead(404);res.end();return;}
 const response=await fetch(url,{signal:AbortSignal.timeout(25000)});res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/octet-stream'});res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(502);res.end('Registry unavailable');}});
server.listen(port,'127.0.0.1',()=>{
 const child=spawn(resolve('.tools/cargo/bin/cargo.exe'),['--config','source.crates-io.replace-with="verified-node-tls"','--config',`source.verified-node-tls.registry="sparse+http://127.0.0.1:${port}/index/"`,...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,CARGO_HOME:resolve('.tools/cargo'),RUSTUP_HOME:resolve('.tools/rustup')}});
 child.on('error',error=>{console.error(error.message);server.closeAllConnections();server.close(()=>process.exit(1));});child.on('exit',code=>{server.closeAllConnections();server.close(()=>process.exit(code??1));});
});

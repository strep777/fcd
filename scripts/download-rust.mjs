import { writeFile } from 'node:fs/promises';
const response = await fetch('https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe');
if (!response.ok) throw new Error(`Download failed: ${response.status}`);
await writeFile('.tools/rustup-init.exe', Buffer.from(await response.arrayBuffer()));

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({root:'apps/desktop',base:'./',resolve:{preserveSymlinks:true},plugins:[vue()],build:{outDir:'../../dist/renderer',emptyOutDir:true}});

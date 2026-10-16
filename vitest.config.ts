import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
// Geometry suites also launch native workers; cap suite concurrency to keep
// their existing time budgets meaningful and leave the desktop responsive.
export default defineConfig({plugins:[vue()],resolve:{preserveSymlinks:true},test:{include:['tests/**/*.test.ts'],environment:'node',maxWorkers:3,testTimeout:15000}});

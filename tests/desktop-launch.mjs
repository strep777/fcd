import {mkdirSync} from 'node:fs';
mkdirSync('.local/tests',{recursive:true});mkdirSync('test-results',{recursive:true});
// Test the current workspace by default; packaged validation opts in explicitly.
export const executablePath = process.env.FPCAD_TEST_EXECUTABLE;
export const desktopArgs = [
  '--fpcad-background-test',
  ...(process.env.FPCAD_TEST_GPU === '1' ? [] : ['--disable-gpu']),
  ...(process.env.FPCAD_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
  ...(executablePath ? [] : [process.env.FPCAD_TEST_APP_DIR ?? '.']),
];
export const testedBuild = { executable: executablePath ?? 'node_modules/electron', source: executablePath ? 'package' : 'workspace',...(process.env.FPCAD_TEST_APP_DIR&&!executablePath?{directory:process.env.FPCAD_TEST_APP_DIR}:{}) };

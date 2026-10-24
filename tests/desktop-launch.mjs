import {mkdirSync} from 'node:fs';
mkdirSync('.local/tests',{recursive:true});mkdirSync('test-results',{recursive:true});
export const executablePath=process.env.FPCAD_TEST_EXECUTABLE;
export const desktopArgs=['--fpcad-background-test'];
export const testedBuild={executable:executablePath??'apps/desktop/src-tauri/target/debug/FurryPatternCAD.exe',source:executablePath?'package':'workspace'};

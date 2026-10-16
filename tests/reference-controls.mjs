import {penPoint} from './pen-helpers.mjs';
import {workflow} from './ui-navigation.mjs';
import {waitForState} from './wait-state.mjs';
export const referenceTools=page=>page.locator('.image-tools');
export async function fitReferenceView(page){await page.getByRole('region',{name:'Pen selection viewport',exact:true}).getByRole('button',{name:'适合窗口',exact:true}).click();}
export async function calibrateReference(page,distance=100){await referenceTools(page).getByRole('button',{name:'两点标定',exact:true}).click();await page.getByLabel('标定真实距离',{exact:true}).fill(String(distance));await page.getByRole('button',{name:'保存标定',exact:true}).click();await waitForState(page,async distance=>{const p=(await window.fpcad.read()).data.project;return p.references.some(r=>r.calibration?.distanceMm===distance);},distance);}
export async function pickReference(page,x,y){const point=await penPoint(page,x,y);await page.mouse.click(point.x,point.y);}
export async function colorReference(page,x,y,tolerance=40){await referenceTools(page).getByRole('button',{name:'按颜色选取',exact:true}).click();await pickReference(page,x,y);await page.getByLabel('颜色容差',{exact:true}).fill(String(tolerance));}
export async function clusterCandidate(page,referenceId,seed,space,clusters=2,minRegionPixels=4,fitToleranceMm=.5){return page.evaluate(async input=>{const p=(await window.fpcad.read()).data.project;return window.fpcad.segmentReference(p.id,p.revision,input.referenceId,input.seed,40,{space:input.space,clusters:input.clusters,minRegionPixels:input.minRegionPixels},input.fitToleranceMm);},{referenceId,seed:{x:seed.x,y:seed.y},space,clusters,minRegionPixels,fitToleranceMm});}
export async function showReferenceState(page){await page.reload();await workflow(page,'references');}

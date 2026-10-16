import{afterAll,expect,it}from'vitest';
import{mkdirSync,writeFileSync}from'node:fs';
import{sourceBlendedMaterials}from'../../packages/reference/source-blended-materials';
import{blendedIslandProposals}from'../../packages/reference/source-blended-islands';
import{illustrationRegions,pigmentFamily}from'../../packages/reference/illustration';
import{cases,fixture,width,height,qualificationCases,qualificationFixture,affineWhiteFixture}from'../fixtures/source-blended-islands';
const records:unknown[]=[];
it.each(cases)('$name retains independently prescribed source material/support',spec=>{
 const f=fixture(spec),before={rgba:f.rgba.slice(),foreground:f.foreground.slice(),labels:f.labels.slice()},moved=sourceBlendedMaterials(width,height,f.rgba,f.foreground,f.labels),changed=Array.from(f.labels,(v,i)=>v!==before.labels[i]?i:-1).filter(i=>i>=0);records.push({name:spec.name,moved,changed,patch:f.patch,patchLabels:f.patch.map(i=>f.labels[i])});
 expect(f.rgba).toEqual(before.rgba);expect(f.foreground).toEqual(before.foreground);expect(moved).toBe(changed.length);
 if(spec.positive){expect(changed).toHaveLength(f.patch.length);expect(changed.every(i=>f.patch.includes(i))).toBe(true);for(const i of f.patch)expect(f.labels[i]).toBe(4);}else{expect.soft(moved,spec.name).toBe(0);expect.soft(f.labels,spec.name).toEqual(before.labels);}
});
it('full classification preserves a visible opaque16px white patch touching two colored materials',()=>{
 const f=fixture(cases.find(s=>s.name==='true-white-16px')!),before=f.rgba.slice(),result=illustrationRegions(width,height,f.rgba,false,'head'),labels=new Int32Array(width*height).fill(-1);
 for(const[r,region]of result.regions.entries())for(const i of region.indices){expect(labels[i]).toBe(-1);labels[i]=r;}
 const owners=[labels[32*width+16],labels[32*width+48],labels[32*width+32]];records.push({name:'full16white',owners,regions:result.regions.map(r=>({color:r.color,pixels:r.indices.length}))});
 expect(new Set(owners).size).toBe(3);expect(owners.every(o=>o>=0)).toBe(true);expect(pigmentFamily(result.regions[owners[2]].color)).toBe(0);expect(f.rgba).toEqual(before);
});
it('a visible white source pixel cannot be swallowed by unobserved extrapolated color planes',()=>{
 const f=affineWhiteFixture(),before={rgba:f.rgba.slice(),foreground:f.foreground.slice(),labels:f.labels.slice()};let max=0;for(let i=0;i<f.labels.length;i++)if(f.labels[i]>0)max=Math.max(max,f.rgba[4*i]+f.rgba[4*i+1]);
 expect(max).toBe(479);expect((492-max)/Math.sqrt(2)).toBeGreaterThan(9);const moved=sourceBlendedMaterials(f.width,f.height,f.rgba,f.foreground,f.labels);expect(moved).toBe(0);expect(f.labels).toEqual(before.labels);expect(f.labels[f.patch[0]]).toBe(0);expect(f.rgba).toEqual(before.rgba);expect(f.foreground).toEqual(before.foreground);
});
it('one total RGB evidence budget cannot accumulate unobserved endpoint and mixture errors',()=>{
 const f=affineWhiteFixture(true),before={rgba:f.rgba.slice(),foreground:f.foreground.slice(),labels:f.labels.slice()};let maximumBlue=0;for(let i=0;i<f.labels.length;i++)if(f.labels[i]>0)maximumBlue=Math.max(maximumBlue,f.rgba[4*i+2]);
 expect(maximumBlue).toBe(140);expect(f.rgba[4*f.patch[0]+2]-maximumBlue).toBe(6);expect(sourceBlendedMaterials(f.width,f.height,f.rgba,f.foreground,f.labels)).toBe(0);expect(f.labels).toEqual(before.labels);expect(f.labels[f.patch[0]]).toBe(0);expect(f.rgba).toEqual(before.rgba);expect(f.foreground).toEqual(before.foreground);
});
it.each(qualificationCases)('$name has source-qualified, atomic island proposals',spec=>{
 const f=qualificationFixture(spec),before={rgba:f.rgba.slice(),foreground:f.foreground.slice(),labels:f.labels.slice()},out=blendedIslandProposals(f.width,f.height,f.rgba,f.foreground,f.labels);records.push({name:spec.name,proposals:out.length,indices:out.map(p=>p.i)});
 expect(f.rgba).toEqual(before.rgba);expect(f.foreground).toEqual(before.foreground);expect(f.labels).toEqual(before.labels);
 if(spec.kind==='positive'){expect(out).toHaveLength(f.patch.length);expect(out.every(p=>f.patch.includes(p.i)&&p.label===4)).toBe(true);}else expect(out).toEqual([]);
});
afterAll(()=>{const directory='test-results/contour-repair/source-blended-islands',stage=process.env.FPCAD_ISLAND_STAGE??'diagnostic';if(!/^[a-z0-9-]+$/.test(stage))throw Error('INVALID_ISLAND_STAGE');mkdirSync(directory,{recursive:true});writeFileSync(directory+'/'+stage+'-metrics.json',JSON.stringify({scope:'Independent fixedRGBA/material/support definitions; production sourceBlendedMaterials and pure island helper. Island budget rollback is phase-local, not a whole-profile rollback claim.',records},null,2));});

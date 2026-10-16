import assert from 'node:assert/strict';
import {chooseProject,workflow} from './ui-navigation.mjs';

// Standalone geometry remains supported by the compatibility command API.
// Manufacturing's ordinary UI now obtains its pieces from the cutting library.
export async function legacyPatternFixture(page,kind='rectangle'){
 const advanced=await page.getByLabel('界面模式',{exact:true}).inputValue();
 const result=await page.evaluate(async kind=>{
  const state=await window.fpcad.read();if(!state.ok)return state;
  const project=state.data.project,id=()=>crypto.randomUUID(),offset=project.pieces.length*30;
  const point=(xMm,yMm)=>({id:id(),xMm,yMm});
  let piece={id:id(),name:`Pattern ${project.pieces.length+1}`,nodes:[[offset,0],[offset+100,0],[offset+100,200],[offset,200]].map(([x,y])=>point(x,y)),closed:true,allowanceMm:10,cutQty:1,mirror:false,material:'毛皮',furRad:Math.PI/2,color:'#73c9b6'};
  if(kind==='circle'){
   const radius=50,count=16,step=2*Math.PI/count,k=4/3*Math.tan(step/4),nodes=Array.from({length:count},(_,i)=>point(radius+radius*Math.cos(i*step),radius+radius*Math.sin(i*step)));
   piece={...piece,nodes,curves:nodes.map((a,i)=>{const b=nodes[(i+1)%count],t=i*step,q=t+step;return {id:id(),startNodeId:a.id,endNodeId:b.id,c1:point(a.xMm-k*radius*Math.sin(t),a.yMm+k*radius*Math.cos(t)),c2:point(b.xMm+k*radius*Math.sin(q),b.yMm-k*radius*Math.cos(q))};}),holes:[],edgeAllowances:[],notches:[],labels:[]};
  }else if(kind==='duplicate'){
   const source=project.pieces.at(-1),ids=new Map(source.nodes.map(n=>[n.id,id()]));
   piece={...structuredClone(source),id:id(),name:source.name+' copy',nodes:source.nodes.map(n=>({...n,id:ids.get(n.id),xMm:n.xMm+30,yMm:n.yMm-30}))};
  }
  return window.fpcad.apply(project.id,project.revision,{type:'piece.put',piece});
 },kind);
 assert(result.ok,JSON.stringify(result));
 const name=result.data.project.pieces.at(-1).name;
 // Reload only synchronizes the renderer; the command and undo journal stay intact.
 await page.reload();await chooseProject(page);await page.getByLabel('界面模式',{exact:true}).selectOption(advanced);await workflow(page,'pattern');
 await page.locator('.cut-selection .cut-row').filter({hasText:name}).locator('button').first().click();
 return result.data.project.pieces.at(-1);
}

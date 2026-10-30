/** A gesture is one history entry, regardless of how many pointer samples it has. */
let sequence=0;
export const nextHistoryStamp=()=>++sequence;
export class DraftHistory<T> {
 private past:{state:T;stamp:number}[]=[];
 private future:{state:T;stamp:number}[]=[];
 private before:T|undefined;
 constructor(private limit=100){}
 record(before:T,after:T){if(JSON.stringify(before)===JSON.stringify(after))return;this.past.push({state:structuredClone(before),stamp:nextHistoryStamp()});if(this.past.length>this.limit)this.past.shift();this.future=[];}
 begin(state:T){if(this.before===undefined)this.before=structuredClone(state);}
 end(state:T){if(this.before!==undefined){this.record(this.before,state);this.before=undefined;}}
 cancel(){this.before=undefined;}
 rollback():T|undefined{const state=this.before;this.before=undefined;return state===undefined?undefined:structuredClone(state);}
 get canUndo(){return this.past.length>0||this.before!==undefined;}
 get canRedo(){return this.future.length>0;}
 get undoStamp(){return this.past.at(-1)?.stamp??0;}
 get redoStamp(){return this.future.at(-1)?.stamp??Infinity;}
 clearRedo(){this.future=[];}
 /** Remove discarded/invalid fields from every undo state without losing
  * independent edits. Drop entries that become no-ops after that removal. */
 rebase(map:(state:T)=>T,current:T){
  const prune=(entries:{state:T;stamp:number}[])=>{let next=JSON.stringify(current);for(let i=entries.length-1;i>=0;i--){entries[i].state=map(entries[i].state);const value=JSON.stringify(entries[i].state);if(value===next)entries.splice(i,1);else next=value;}};
  prune(this.past);prune(this.future);this.before=undefined;
 }
 get grouping(){return this.before!==undefined;}
 clear(){this.past=[];this.future=[];this.before=undefined;}
 move(current:T,redo=false):T|undefined{const from=redo?this.future:this.past,to=redo?this.past:this.future;if(!from.length)return;const entry=from.pop()!;to.push({state:structuredClone(current),stamp:entry.stamp});return structuredClone(entry.state);}
}

export type CutArc={from:number;to:number;capacity:number};
/** Internal graph primitive. A bounded iterative Dinic solve returns a side
 * only after the sink is unreachable in the residual graph. Budget exhaustion
 * returns no partial cut. Callers retain the original material decision. */
export function minimumSTCut(nodes:number,arcs:Iterable<CutArc>,source:number,sink:number,operationLimit:number){
 if(!Number.isInteger(nodes)||nodes<2||!Number.isInteger(source)||!Number.isInteger(sink)||source<0||sink<0||source>=nodes||sink>=nodes||source===sink||!Number.isInteger(operationLimit)||operationLimit<0)throw Error('INVALID_GRAPH');
 const graph:{to:number;capacity:number;reverse:number}[][]=Array.from({length:nodes},()=>[]);
 for(const {from,to,capacity}of arcs){if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=nodes||to>=nodes||!Number.isFinite(capacity)||capacity<0)throw Error('INVALID_GRAPH');if(from===to||!capacity)continue;const a={to,capacity,reverse:graph[to].length},b={to:from,capacity:0,reverse:graph[from].length};graph[from].push(a);graph[to].push(b);}
 const level=new Int32Array(nodes),cursor=new Int32Array(nodes);let operations=0;
 const spend=()=>{if(operations>=operationLimit)throw Error('GRAPH_BUDGET');operations++;};
 const augment=():number=>{
  const vertices=[source],edges:number[]=[];
  while(vertices.length){spend();const v=vertices.at(-1)!;
   if(v===sink){let amount=Infinity;for(let i=0;i<edges.length;i++)amount=Math.min(amount,graph[vertices[i]][edges[i]].capacity);for(let i=0;i<edges.length;i++){const e=graph[vertices[i]][edges[i]];e.capacity-=amount;graph[e.to][e.reverse].capacity+=amount;}return amount;}
   let advanced=false;
   while(cursor[v]<graph[v].length){spend();const e=graph[v][cursor[v]];if(e.capacity>1e-8&&level[e.to]===level[v]+1){edges.push(cursor[v]);vertices.push(e.to);advanced=true;break;}cursor[v]++;}
   if(!advanced){level[v]=-1;vertices.pop();edges.pop();if(vertices.length)cursor[vertices.at(-1)!]++;}
  }return 0;
 };
 try{
  while(true){
   level.fill(-1);level[source]=0;const queue=[source];
   for(let i=0;i<queue.length;i++)for(const e of graph[queue[i]]){spend();if(e.capacity>1e-8&&level[e.to]<0){level[e.to]=level[queue[i]]+1;queue.push(e.to);}}
   if(level[sink]<0){const side=Uint8Array.from(level,v=>v>=0?1:0);return{side,operations,converged:true};}
   cursor.fill(0);while(augment()>1e-8){}
  }
 }catch(error){if(!(error instanceof Error)||error.message!=='GRAPH_BUDGET')throw error;return{side:null,operations,converged:false};}
}

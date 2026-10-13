import {localize} from '../localization';
import {localizeRecord} from '../localization';
import {computed,nextTick,onBeforeUnmount,ref,toRaw,watch,type Ref} from 'vue';
import {useSession} from '../store';
import {useDraftHistory} from './useDraftHistory';
import {interiorAnchor} from '../../../../packages/pattern/interior';
import {circlePiece} from '../../../../packages/pattern/shapes';
import {mapPiece,moveNode,duplicatePiece,piecePath,pointBounds} from '../../../../packages/pattern/edit';
import {messages,issueMessages} from '../i18n';
import {outputBudgetIssues} from '../../../../packages/manufacturing/output-limits';
import {cameraBox,zoomCamera} from '../../../../packages/ui/viewport';
import {previewRuler,pieceDimensions} from '../../../../packages/ui/pattern-preview';
import type {Piece,Point,Join,Paper} from '../../../../packages/schema/index';
import type {Stage} from './workflow-tabs';
export function usePatternEditor(language:Ref<'zh'|'en'>,stage:Ref<Stage>,openJobs:()=>void){
const store=useSession(),t=computed(()=>localizeRecord(messages[language.value])),project=computed(()=>store.data.project);
const selectedId=ref(''),choiceIds=ref<string[]>([]),selected=computed(()=>project.value?.pieces.find(p=>p.id===selectedId.value));
const filteredPieces=computed(()=>project.value?.pieces??[]);
const geometry=computed(()=>store.data.geometry.find(g=>g.id===selectedId.value));
const issues=computed(()=>[...store.data.geometry.flatMap(g=>g.issues),...(project.value?outputBudgetIssues(project.value,store.data.geometry):[])]);

const draftClosed=ref(true);
const tool=ref<'pan'|'select'|'node'|'polygon'|'measure'>('select'),draft=ref<Point[]>([]),preview=ref<Piece|null>(null),svg=ref<SVGSVGElement>();
const fitWidth=ref(650),viewportSize=ref({width:800,height:600});
const view=ref({x:-60,y:-330,w:650,h:480}),snap=ref(true),selectedNode=ref('');
const nodeX=ref(0),nodeY=ref(0),candidateDistance=ref(10),candidateJoin=ref<Join>('miter'),holeTarget=ref(''),measurement=ref<Point[]>([]),mappedPoint=ref<{pieceId:string;xMm:number;yMm:number}|null>(null),paperPreset=ref('A4'),paper=ref<Paper>({widthMm:210,heightMm:297,marginMm:10,overlapMm:10});
const draftHistory=useDraftHistory(()=>({nodes:draft.value,closed:draftClosed.value,hole:holeTarget.value}),value=>{draft.value=value.nodes;draftClosed.value=value.closed;holeTarget.value=value.hole;},()=>stage.value==='pattern'&&tool.value==='polygon',()=>store.busy);

watch(paperPreset,key=>{const sizes:Record<string,[number,number]>={A4:[210,297],A3:[297,420],A2:[420,594],A1:[594,841],A0:[841,1189]};if(sizes[key]){paper.value.widthMm=sizes[key][0];paper.value.heightMm=sizes[key][1];}});

function selectPiece(id:string,focus=true){selectedId.value=id;if(id&&focus)void nextTick(()=>focusSelection());}
async function importSvg(){const p=project.value;if(p)await store.run(()=>window.fpcad.importPattern(p.id,p.revision,1));}
async function offsetCandidate(){const p=project.value,s=selected.value;if(!p||!s)return;openJobs();await store.run(()=>window.fpcad.offset(p.id,p.revision,s.id,candidateDistance.value,candidateJoin.value));}
const measureMm=computed(()=>measurement.value.length===2?Math.hypot(measurement.value[1].xMm-measurement.value[0].xMm,measurement.value[1].yMm-measurement.value[0].yMm):0);
let drag:{start:Point;piece:Piece;nodeId?:string;pointerId:number;projectId:string;revision:number}|null=null;
let pan:{start:DOMPoint;matrix:DOMMatrix;view:typeof view.value;pointerId:number}|null=null;
let anchorCache=new WeakMap<Piece,ReturnType<typeof interiorAnchor>>();
function cachedAnchor(p:Piece){const key=toRaw(p);let anchor=anchorCache.get(key);if(!anchor){anchor=interiorAnchor(p.nodes,p.holes);anchorCache.set(key,anchor);}return anchor;}
let gestureFrame=0,pendingMove:PointerEvent|undefined;
function flushMove(){if(gestureFrame)cancelAnimationFrame(gestureFrame);gestureFrame=0;const event=pendingMove;pendingMove=undefined;if(event)applyMove(event);}
function clearMove(){if(gestureFrame)cancelAnimationFrame(gestureFrame);gestureFrame=0;pendingMove=undefined;}
onBeforeUnmount(clearMove);
let pathCache=new WeakMap<Piece,string>(),cutCache=new WeakMap<object,string>();
function cachedPiecePath(p:Piece){let path=pathCache.get(p);if(path===undefined){path=piecePath(p);pathCache.set(p,path);}return path;}

const candidateMode=computed(()=>(stage.value==='cutting')&&!!project.value?.surfaceRun&&!project.value.surfaceRun.accepted);
const shownMarkings=computed(()=>candidateMode.value?project.value?.previewMarkings??[]:project.value?.markings??[]);
const shownPieces=computed(()=>{const pieces=candidateMode.value?project.value?.surfaceRun?.pieces??[]:project.value?.pieces??[];return pieces.filter(p=>stage.value!=='pattern'||p.id===(selectedId.value||pieces[0]?.id)).map(p=>preview.value?.id===p.id?preview.value:p);});
const zoomPercent=computed(()=>fitWidth.value/view.value.w*100),scaleRuler=computed(()=>previewRuler(Math.min(viewportSize.value.width/view.value.w,viewportSize.value.height/view.value.h)));
const previewBounds=computed(()=>{const p=shownPieces.value.find(p=>p.id===selectedId.value)??shownPieces.value[0];if(!p)return;const g=preview.value?.id===p.id?undefined:store.data.geometry.find(g=>g.id===p.id);if(!g?.seam?.length)return {name:p.name,...pieceDimensions(p)};const b=pointBounds(g.seam);return {name:p.name,widthMm:b.maxX-b.minX,heightMm:b.maxY-b.minY};});
const previewPaper=computed({get:()=>paper.value.widthMm===297&&paper.value.heightMm===420?'A3':paper.value.widthMm===210&&paper.value.heightMm===297?'A4':'Custom',set:(key:string)=>{const size=key==='A3'?[297,420]:[210,297];paperPreset.value=key;paper.value.widthMm=size[0];paper.value.heightMm=size[1];}}),paperSize=computed(()=>[paper.value.widthMm,paper.value.heightMm]);
watch(stage,async key=>{cancel();if(key==='pattern'&&!project.value?.pieces.some(p=>p.id===selectedId.value))selectedId.value=project.value?.pieces[0]?.id??'';await nextTick();key==='pattern'?focusSelection():fit();});

const bounds=computed(()=>{const p=selected.value;if(!p)return {w:0,h:0};const g=store.data.geometry.find(g=>g.id===p.id),nodes=g?.seam?.length?g.seam:p.nodes;return {w:Math.max(...nodes.map(n=>n.xMm))-Math.min(...nodes.map(n=>n.xMm)),h:Math.max(...nodes.map(n=>n.yMm))-Math.min(...nodes.map(n=>n.yMm))};});
const fmt=(n:number)=>Number(n.toFixed(3)).toLocaleString(language.value==='zh'?'zh-CN':'en-US');
function label(key:string){return localize(issueMessages[key]?.[language.value==='zh'?0:1]??key);}
function ringPath(nodes:{xMm:number;yMm:number}[]){return nodes.map((n,i)=>`${i?'L':'M'}${n.xMm},${-n.yMm}`).join(' ')+' Z';}
function cutPath(id:string){const g=store.data.geometry.find(g=>g.id===id)??project.value?.surfaceRun?.cutPreview?.find(g=>g.id===id);if(!g)return '';let path=cutCache.get(g);if(path===undefined){path=[g.cut,...(g.cutHoles??[])].map(ringPath).join(' ');cutCache.set(g,path);}return path;}
function poly(nodes:{xMm:number;yMm:number}[]){return nodes.map(n=>`${n.xMm},${-n.yMm}`).join(' ');}
function world(event:PointerEvent){const matrix=svg.value?.getScreenCTM();if(!matrix)return;const screen=svg.value!.createSVGPoint();screen.x=event.clientX;screen.y=event.clientY;const result=screen.matrixTransform(matrix.inverse());return {id:crypto.randomUUID(),xMm:snap.value?Math.round(result.x/5)*5:result.x,yMm:snap.value?Math.round(-result.y/5)*5:-result.y};}
watch(selectedId,id=>{if(id)choiceIds.value=[];});
function showChoices(ids:string[]){choiceIds.value=ids;if(ids.length){selectedId.value='';mappedPoint.value=null;fit();}}
function startHole(){draftHistory.reset(()=>{draftClosed.value=true;holeTarget.value=selectedId.value;draft.value=[];tool.value='polygon';});}
function stopGesture(){clearMove();preview.value=null;drag=null;pan=null;}
function cancel(){clearMove();draftHistory.reset(()=>{draftClosed.value=true;holeTarget.value='';draft.value=[];preview.value=null;drag=null;pan=null;});}
function changePreviewTool(value:'pan'|'select'){cancel();tool.value=value;measurement.value=[];}
function changeTool(value:typeof tool.value){stage.value='pattern';cancel();tool.value=value;measurement.value=[];}
async function put(piece:Piece){const p=project.value;if(!p)return;const ok=await store.run(()=>window.fpcad.apply(p.id,p.revision,{type:'piece.put',piece:JSON.parse(JSON.stringify(piece))}));if(ok)selectedId.value=piece.id;}
function createPiece(nodes:Point[],closed=true):Piece{return {id:crypto.randomUUID(),name:`Pattern ${(project.value?.pieces.length??0)+1}`,nodes,closed,allowanceMm:10,cutQty:1,mirror:false,material:language.value==='zh'?'毛皮':localize('Fur'),furRad:Math.PI/2,color:'#73c9b6'};}
async function rectangle(){stage.value='pattern';const offset=(project.value?.pieces.length??0)*30;await put(createPiece([[offset,0],[offset+100,0],[offset+100,200],[offset,200]].map(([xMm,yMm])=>({id:crypto.randomUUID(),xMm,yMm}))));}
async function circle(){stage.value='pattern';await put(circlePiece(createPiece([]),50,()=>crypto.randomUUID()));}
function startOpenPath(){changeTool('polygon');draftClosed.value=false;draftHistory.reset();}
async function finish(){if(draft.value.length<(draftClosed.value?3:2))return;const target=project.value?.pieces.find(p=>p.id===holeTarget.value);const piece=target?{...target,holes:[...(target.holes??[]),draft.value]}:createPiece(draft.value,draftClosed.value);cancel();await put(piece);tool.value='node';}
function down(event:PointerEvent,piece?:Piece,node?:Point){
 if(event.button===1||event.button===0&&tool.value==='pan'){event.preventDefault();const screenMatrix=svg.value?.getScreenCTM();if(!screenMatrix)return;const matrix=screenMatrix.inverse();pan={pointerId:event.pointerId,start:new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix),matrix,view:{...view.value}};svg.value!.setPointerCapture(event.pointerId);return;}
 if(store.busy||!project.value||event.button!==0)return;if(stage.value!=='pattern'){if(piece)selectPiece(piece.id,false);return;}const point=world(event);if(!point)return;
 if(tool.value==='polygon'){draft.value.push(point);return;}
 if(tool.value==='measure'){measurement.value=measurement.value.length===1?[measurement.value[0],point]:[point];return;}
 if(!piece){selectedId.value='';selectedNode.value='';return;}selectPiece(piece.id,false);
 if(node){selectedNode.value=node.id;nodeX.value=node.xMm;nodeY.value=node.yMm;}
 drag={start:point,piece:JSON.parse(JSON.stringify(piece)),nodeId:node?.id,pointerId:event.pointerId,projectId:project.value.id,revision:project.value.revision};anchorCache.set(drag.piece,cachedAnchor(piece));svg.value!.setPointerCapture(event.pointerId);
}
function move(event:PointerEvent){if(!pan&&!drag)return;pendingMove=event;if(!gestureFrame)gestureFrame=requestAnimationFrame(flushMove);}
function applyMove(event:PointerEvent){if(pan){if(pan.pointerId!==event.pointerId)return;const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(pan.matrix);view.value={...pan.view,x:pan.view.x-(point.x-pan.start.x),y:pan.view.y-(point.y-pan.start.y)};return;}if(!drag)return;const point=world(event);if(!point)return;const dx=point.xMm-drag.start.xMm,dy=point.yMm-drag.start.yMm;const n=[...drag.piece.nodes,...(drag.piece.holes??[]).flat()].find(n=>n.id===drag!.nodeId);const candidate=n?moveNode(drag.piece,n.id,n.xMm+dx,n.yMm+dy):mapPiece(drag.piece,n=>({xMm:n.xMm+dx,yMm:n.yMm+dy}));const anchor=cachedAnchor(drag.piece);anchorCache.set(candidate,n?anchor:{...anchor,xMm:anchor.xMm+dx,yMm:anchor.yMm+dy});preview.value=candidate;}
async function up(){flushMove();if(pan){pan=null;return;}if(!drag)return;const candidate=preview.value;const original=drag.piece,origin={projectId:drag.projectId,revision:drag.revision};preview.value=null;drag=null;if(stage.value!=='pattern')return;if(project.value?.id!==origin.projectId||project.value.revision!==origin.revision){store.error='STALE_EDIT';return;}if(candidate&&JSON.stringify(candidate)!==JSON.stringify(original))await put(candidate);}
function zoomBy(factor:number,anchor?:{x:number;y:number}){if(drag||pan||!Number.isFinite(factor)||factor<=0)return;const fitHeight=fitWidth.value*view.value.h/view.value.w,base={x:view.value.x+view.value.w/2-fitWidth.value/2,y:view.value.y+view.value.h/2-fitHeight/2,width:fitWidth.value,height:fitHeight},box=cameraBox(base,zoomCamera(base,{zoom:zoomPercent.value/100,panX:0,panY:0},factor,anchor));view.value={x:box.x,y:box.y,w:box.width,h:box.height};}
function setZoomPercent(value:number){if(Number.isFinite(value)&&value>0)zoomBy(value/zoomPercent.value);}
function zoom(event:WheelEvent){event.preventDefault();if(!Number.isFinite(event.deltaY)||event.deltaY===0)return;let anchor:{x:number;y:number}|undefined;const matrix=svg.value?.getScreenCTM();if(matrix&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)){const point=svg.value!.createSVGPoint();point.x=event.clientX;point.y=event.clientY;anchor=point.matrixTransform(matrix.inverse());}zoomBy(event.deltaY>0?1/1.15:1.15,anchor);}
function fit(){fitPieces((candidateMode.value?project.value?.surfaceRun?.pieces:project.value?.pieces)?.map(p=>p.id)??[]);}
function focusSelection(){fitPieces(selectedId.value?[selectedId.value]:choiceIds.value);}
function fitPieces(ids:string[]){const selected=new Set(ids),nodes=(candidateMode.value?project.value?.surfaceRun?.pieces:project.value?.pieces)?.filter(p=>selected.has(p.id)).flatMap(p=>{const g=store.data.geometry.find(g=>g.id===p.id);return g?.cut?.length?g.cut:g?.seam?.length?g.seam:p.nodes;})??[];if(!nodes.length)return;const {minX,maxX,minY,maxY}=pointBounds(nodes);const ratio=(svg.value?.clientWidth||viewportSize.value.width)/(svg.value?.clientHeight||viewportSize.value.height);const w=Math.max(maxX-minX+100,(maxY-minY+100)*ratio);fitWidth.value=w;view.value={x:(minX+maxX-w)/2,y:-(minY+maxY+w/ratio)/2,w,h:w/ratio};}
async function update(field:keyof Piece,value:unknown){if(selected.value)await put({...selected.value,[field]:value,...(field==='material'?{materialId:undefined,allowanceSource:'piece' as const}:{})});}
async function resize(axis:'xMm'|'yMm',value:number){if(!selected.value||!Number.isFinite(value)||value<=0)return;const current=axis==='xMm'?bounds.value.w:bounds.value.h;if(!current)return;const seam=geometry.value?.seam?.length?geometry.value.seam:selected.value.nodes,min=Math.min(...seam.map(n=>n[axis])),ratio=value/current,angle=selected.value.furRad;await put({...mapPiece(selected.value,n=>({...n,[axis]:min+(n[axis]-min)*ratio})),furRad:Math.atan2(Math.sin(angle)*(axis==='yMm'?ratio:1),Math.cos(angle)*(axis==='xMm'?ratio:1)),grainRad:selected.value.grainRad===undefined?undefined:Math.atan2(Math.sin(selected.value.grainRad)*(axis==='yMm'?ratio:1),Math.cos(selected.value.grainRad)*(axis==='xMm'?ratio:1))});}
async function transform(kind:'rotate'|'mirror'){const p=selected.value;if(!p)return;const cx=(Math.min(...p.nodes.map(n=>n.xMm))+Math.max(...p.nodes.map(n=>n.xMm)))/2,cy=(Math.min(...p.nodes.map(n=>n.yMm))+Math.max(...p.nodes.map(n=>n.yMm)))/2;await put({...mapPiece(p,n=>({xMm:kind==='rotate'?cx-(n.yMm-cy):2*cx-n.xMm,yMm:kind==='rotate'?cy+n.xMm-cx:n.yMm})),furRad:kind==='rotate'?p.furRad+Math.PI/2:Math.PI-p.furRad,grainRad:p.grainRad===undefined?undefined:kind==='rotate'?p.grainRad+Math.PI/2:Math.PI-p.grainRad});}
async function duplicate(){const p=selected.value;if(!p)return;await put(duplicatePiece(p));}
async function remove(){const p=project.value,s=selected.value;if(!p||!s)return;if(await store.run(()=>window.fpcad.apply(p.id,p.revision,{type:'piece.delete',pieceId:s.id})))selectedId.value='';}
async function applyNode(){const p=selected.value;if(!p)return;await put(moveNode(p,selectedNode.value,nodeX.value,nodeY.value));}

const allNodes=(piece?:Piece)=>piece?[...piece.nodes,...(piece.holes??[]).flat()]:[];
watch(selected,()=>{if(!allNodes(selected.value).some(n=>n.id===selectedNode.value))selectedNode.value='';});
watch(()=>selected.value?.id,()=>{candidateDistance.value=selected.value?.allowanceMm??10;candidateJoin.value=selected.value?.join??'miter';});
watch(()=>selected.value?.allowanceMm,value=>{candidateDistance.value=value??10;});
watch(()=>selected.value?.join,value=>{candidateJoin.value=value??'miter';});
watch(()=>allNodes(selected.value).find(n=>n.id===selectedNode.value), (point,previous)=>{if(point&&(point.id!==previous?.id||point.xMm!==previous.xMm||point.yMm!==previous.yMm)){nodeX.value=point.xMm;nodeY.value=point.yMm;}},{immediate:true});
watch(()=>[project.value?.id,project.value?.pieces.length] as const,([id,count],[previousId,previousCount])=>{if(id!==previousId||(count??0)-(previousCount??0)>1)void nextTick(()=>fit());});
watch(()=>project.value?.surfaceRun,async()=>{await nextTick();if(candidateMode.value)fit();});

return {openJobs,measureMm,store,language,t,stage,project,selectedId,choiceIds,selected,filteredPieces,geometry,issues,draftClosed,tool,draft,preview,svg,view,viewportSize,zoomPercent,scaleRuler,previewBounds,snap,selectedNode,nodeX,nodeY,candidateDistance,candidateJoin,holeTarget,paperPreset,paper,measurement,mappedPoint,candidateMode,shownMarkings,shownPieces,previewPaper,paperSize,bounds,fmt,label,cutPath,cachedPiecePath,cachedAnchor,poly,allNodes,selectPiece,importSvg,offsetCandidate,showChoices,startHole,cancel,stopGesture,changeTool,changePreviewTool,put,rectangle,circle,startOpenPath,finish,down,move,up,zoom,zoomBy,setZoomPercent,fit,focusSelection,update,resize,transform,duplicate,remove,applyNode};
}

import type {Project} from '../schema/index';

/** Single catalog for workflow navigation and mutation ownership checks. */
export function workflowNodes(p:Project,zh=true){
 const stages=[{key:'references',title:zh?'双视图与花纹':'Dual views & markings',stage:'references' as const,summary:`${p.references?.length??0} / 2 · ${p.patternLibrary?.length??0} ${zh?'个花纹':'regions'}`},
 {key:'model',title:zh?'模型管理':'Model management',stage:'model' as const,summary:`${p.modelLibrary?.length??0} ${zh?'个模型':'models'} · ${p.markings?.length??0} ${zh?'处贴附':'markings'}`},
 {key:'mapping',title:zh?'花纹映射':'Pattern mapping',stage:'mapping' as const,summary:`${p.markings?.length??0} ${zh?'处贴附':'markings'}`},
 {key:'unwrap',title:zh?'开裁':'Cutting',stage:'cutting' as const,summary:`${p.surface?.cutConstraints?.length??0} ${zh?'条切分线':'cuts'} · ${p.surfaceRun?.accepted?(zh?'已采用':'accepted'):p.surfaceRun?(zh?'预览中':'preview'):(zh?'待计算':'pending')}`},
 {key:'pattern',title:zh?'制版与打印':'Pattern making & printing',stage:'pattern' as const,summary:`${p.pieces.length} ${zh?'个裁片':'pieces'}`}];
 const entities=[...(p.references??[]).map(r=>({key:'reference:'+r.id,title:r.name,stage:'references' as const,id:r.id,summary:zh?(r.view==='front'?'正面参考图':'背面参考图'):r.view})),
 ...(p.patternLibrary??[]).map(r=>({key:'region:'+r.piece.id,title:r.piece.name,stage:'references' as const,id:r.piece.id,summary:r.category})),
 ...(p.modelLibrary??[]).map(m=>({key:'model:'+m.id,title:m.name,stage:'model' as const,id:m.id,summary:m.surface.source})),
 ...(p.surface?.cutLines??[]).map(line=>({key:'cutLine:'+line.id,id:'cutLine:'+line.id,title:line.name,stage:'cutting' as const,summary:`${line.kind} · ${line.edges.length} ${zh?'段':'edges'} · ${line.enabled?(zh?'已启用':'enabled'):(zh?'已停用':'disabled')}`})),
 ...(p.surface?.cutBaseConstraints??p.surface?.cutConstraints??[]).map((edge,i)=>({key:'cut:'+edge.a+':'+edge.b,id:'cut:'+edge.a+':'+edge.b,title:(zh?'切分线 ':'Cut line ')+(i+1),stage:'cutting' as const,summary:edge.a.slice(0,6)+' → '+edge.b.slice(0,6)})),
 ...(p.markings??[]).map(m=>({key:'marking:'+m.id,title:m.name,stage:'mapping' as const,id:m.id,summary:m.color})),
 ...p.pieces.map(piece=>({key:'piece:'+piece.id,title:piece.name,stage:'pattern' as const,id:piece.id,summary:`${piece.cutQty}× · ${piece.color}`})),
 ...(p.materials??[]).map(m=>({key:'material:'+m.id,title:m.name,stage:'pattern' as const,id:m.id,tab:'materials' as const,summary:zh?'材料':'material'})),
 ...(p.seams??[]).map(s=>({key:'seam:'+s.id,title:s.name,stage:'pattern' as const,id:s.id,tab:'seams' as const,summary:zh?'接缝':'seam'})),
 ...(p.nesting?[{key:'nesting',title:zh?'排料布局':'Nesting layout',stage:'pattern' as const,tab:'nesting' as const,summary:`${p.nesting.sheets.length} ${zh?'张排料图':'sheets'}`}]:[])];
 return [...stages,...entities].map(n=>({...n,...p.workflow?.find(record=>record.key===n.key)}));
}

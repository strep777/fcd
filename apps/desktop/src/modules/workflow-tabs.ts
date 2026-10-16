export type Stage='guide'|'references'|'model'|'mapping'|'cutting'|'assembly'|'pattern';
export type PatternTab='pieces'|'materials'|'seams'|'nesting'|'workflow';
/** Independent workflow stages compose shared tools. */
export const workflowTabs=[
 {id:'guide',zh:'使用指南',en:'Guide',model:false,zhHint:'操作流程、参数含义和选区工具'},
 {id:'references',zh:'花纹提取',en:'Pattern extraction',model:false,zhHint:'上传、标定和拆分正背视图，分类保存花纹'},
 {id:'model',zh:'模型管理',en:'Model management',model:true,zhHint:'选择或上传模型，编辑尺寸与形状，自动保存模型'},
 {id:'mapping',zh:'花纹映射',en:'Pattern mapping',model:true,zhHint:'从花纹抽屉贴附、修正路径或 UV，补画缺失花纹'},
 {id:'cutting',zh:'裁切版型',en:'Cutting',model:true,zhHint:'沿花纹与裁切线生成裁片，检查失真与必要补缝'},
 {id:'assembly',zh:'拼接预览',en:'Cut assembly',model:false,zhHint:'用实际裁片还原三维拼接，检查缺片、接缝与保存版本'},
 {id:'pattern',zh:'制版',en:'Pattern making',model:false,zhHint:'调整裁片和标签，分页打印，保存和交换制作流'},
] as const;
export const isModelStage=(stage:Stage)=>workflowTabs.some(t=>t.id===stage&&t.model);

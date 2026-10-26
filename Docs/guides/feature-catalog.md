# 功能清单与实现边界

基准：2026-10-26，版本 0.8.0，HEAD `0bd71c8`。源码已提交，文档仍在工作区整理。本文按源码整理，没有启动软件或执行测试。**已存在**表示找到界面入口和处理实现；**部分支持**表示链路或适用条件有限，均不表示制作效果已验收。功能 ID 供需求和测试引用，后续增补不重排已有 ID。

操作见[使用流程](user-workflow.md)，待办与验收见[需求与验收](../planning/requirements.md)。尺寸默认毫米，像素、角度、厘米和倍率另行标明。

## 项目与工作区

| ID / 状态 | 入口与操作 | 输入 → 输出 | 失败、取消与恢复 | 源码证据 |
| --- | --- | --- | --- | --- |
| F01 本地项目，已存在 | 首页新建、选择、删除；顶部切换项目 | 名称 → 本地会话、修订号及最近项目列表 | 首次读取失败可重试；删除须确认，清除该会话历史及无用资源且无法撤销，单独保存的文件保留 | [App.vue](../../apps/desktop/src/App.vue)，`readInitialProjects/create/activateSession/deleteProject`；[main.ts](../../apps/desktop/main/main.ts)，`session.* / project.create` |
| F02 项目文件，已存在 | 顶部打开、保存、另存为 | `.fpcad` ↔ 项目及资源；提交另写本地工作库 | 取消文件选择返回取消状态；打开前校验契约及资源；交互草稿不等于已保存项目 | [App.vue](../../apps/desktop/src/App.vue)，`openProject/save`；[main.ts](../../apps/desktop/main/main.ts)，`project.open/project.save` |
| F03 历史与恢复，已存在 | 顶部撤销/重做；检查与记录中的历史、恢复点 | 草稿操作或已提交修订 → 历史状态；恢复点 → 当前状态 | 草稿与提交历史协调排序；新草稿会阻止跨边界重做；花纹修改离开前可保存、放弃或返回 | [App.vue](../../apps/desktop/src/App.vue)，`undo/restore/requestMarkingLeave`；[useDraftHistory.ts](../../apps/desktop/src/modules/useDraftHistory.ts)；[repository.ts](../../apps/desktop/main/repository.ts) |
| F04 界面与导航，已存在 | 8 阶段、简单/高级模式、中英日语言、分栏拖动 | 阶段/视图设置 → 当前工作区 | 简单模式将制版子页切回版型预览；界面模式当前是内存 `ref(false)`，不能承诺跨启动记忆；部分分栏设置存本机 | [workflow-tabs.ts](../../apps/desktop/src/modules/workflow-tabs.ts)，`workflowTabs`；[App.vue](../../apps/desktop/src/App.vue)，第 69 行；[PatternPage.vue](../../apps/desktop/src/PatternPage.vue)；[WorkspaceSplit.vue](../../apps/desktop/src/WorkspaceSplit.vue) |

## 原图与花纹库

| ID / 状态 | 入口与操作 | 输入 → 输出 | 失败、取消与恢复 | 源码证据 |
| --- | --- | --- | --- | --- |
| F05 整图提取，部分支持 | 上传并提取、仅导入、按当前标定重新提取 | PNG/JPEG/WebP 整张设定图 → 原图、颜色区域、部位/左右侧建议和制作方式 | 重新提取替换来源及相关贴附，锁定来源可阻止；分类和细节需复核；任务可取消 | [MarkingsPage.vue](../../apps/desktop/src/MarkingsPage.vue)，`upload/importSingle/split`；[main.ts](../../apps/desktop/main/main.ts)，`reference.import/reference.auto/reference.splitAll` |
| F06 两点标定，已存在 | 原图选两点、填真实距离并保存 | 两个像素点、毫米距离 → 像素/毫米变换及来源尺寸 | 两点不能重合，距离需为正；未保存标定时不能生成选区；更新会移除旧贴附，锁定贴附会阻止修改 | [ReferencesPanel.vue](../../apps/desktop/src/ReferencesPanel.vue)，`calibrationValid/calibrate`，第 40–46 行 |
| F07 颜色/手工选区，已存在 | 颜色种子、钢笔、套索；高级叠加/减去、载入和参考补全；确认并加入库 | 容差 0–442，闭合路径、孔洞、颜色 → 确认时计算并保存来源；接口亦保留独立候选/接受 | 草稿可撤销/重做/清空；当前页显式传库目标，一次确认即入库，不需再接受一次；旧/接口候选未接受时非正式来源；无标定、未闭合、超预算或未审阅补全会拒绝 | [ReferencesPanel.vue](../../apps/desktop/src/ReferencesPanel.vue)，`segment/accept`；[MaskEditor.vue](../../apps/desktop/src/MaskEditor.vue)，`candidate/fromPieces/complete`；[repository.ts](../../apps/desktop/main/repository.ts)，`reference.candidate/reference.accept` |
| F08 花纹库，已存在 | 搜索、按部位分组、多选/删除和修改属性 | 名称、颜色、类别、部位、自身左右侧、`sewn/detail` → 库区域及依赖状态 | 删除来源会移除关联贴附及派生推断，含非活动模型；锁定关联阻止整批删除，成功可撤销且保留裁切历史。含糊分类保留 unknown；`detail` 保留图形但不单独沿它生成缝制裁片 | [MarkingLibrary.vue](../../apps/desktop/src/MarkingLibrary.vue)，`deleteIds/metadata/classify/fabrication`；[repository.ts](../../apps/desktop/main/repository.ts)，`pruneSources` |
| F09 来源修改，已存在 | 独立花纹修改画布补画/擦除、钢笔修补、节点微调 | 区域及笔画/节点/孔洞草稿 → 原来源与关联贴附更新 | 失败保留草稿；断岛、擦空、无效几何、锁定/绑定/失效关联或修订冲突时拒绝；切换须处理未保存修改 | [MarkingEditPage.vue](../../apps/desktop/src/MarkingEditPage.vue)，`selectSource/saveSource/save`；[SourceRegionEditor.vue](../../apps/desktop/src/SourceRegionEditor.vue)，`canConfirm/saveMessage/getEdit`；[main.ts](../../apps/desktop/main/main.ts)，`library.region.edit` |

自动提取使用传统图像处理和规则推断。部位建议、人物分区和遮挡补全不能称为已训练的语义模型。高级曲线拟合允许输入 0.01–0.5 mm 偏差，不保证所有原图都能拟合为少节点曲线。

## 模型与贴附

| ID / 状态 | 入口与操作 | 输入 → 输出 | 失败、取消与恢复 | 源码证据 |
| --- | --- | --- | --- | --- |
| F10 生成/导入模型，部分支持 | 三角 OBJ/GLB、内置物种模板；高级另有实验躯干；静态 GLB 导出 | 倍率或身体/物种参数 → 毫米网格与测量报告 | OBJ 毫米用 1、厘米用 10；GLB 米转毫米后再乘倍率。DTD、一体填充、兽装外形含义不同，生成后需复核尺寸 | [ModelTools.vue](../../apps/desktop/src/ModelTools.vue)，`generateTemplate/importMesh/generate/exportMesh`；[main.ts](../../apps/desktop/main/main.ts)，`species.generate/body.generate/surface.import/surface.export` |
| F11 模型库/部位，已存在 | 搜索、切换、改名/删除；指定模型类型、部件分类和自身左右侧 | 库记录和分类 → 当前模型及其花纹/裁片状态 | 生成/导入自动入库，增删改可撤销；通用网格和特殊姿势须逐组复核，不能只凭命名保证解剖识别 | [ModelLibrary.vue](../../apps/desktop/src/ModelLibrary.vue)，`activate/rename/remove`；[ModelAnatomyPanel.vue](../../apps/desktop/src/ModelAnatomyPanel.vue)，`classify/assign` |
| F12 模型编辑，已存在 | 对象/部位/顶点拖动或数值移动、旋转、缩放；尺寸和身体测量约束 | 毫米、角度、倍率、目标测量 → 更新网格 | 整体变换携带花纹，局部编辑使旧投影失效；内置模型自由缩放后成为通用网格，原配方报告不再适用；需重裁 | [ModelEditControls.vue](../../apps/desktop/src/ModelEditControls.vue)，`apply`；[ModelTools.vue](../../apps/desktop/src/ModelTools.vue)，`resizeModel/applyBodyTargets`；[SurfacePanel.vue](../../apps/desktop/src/SurfacePanel.vue)，模型拖动 |
| F13 模板拟合/雕刻，部分支持 | 自定义模板、实测目标、Morph、局部移动/平滑 | `.fpctemplate`/JSON 声明的测量环和权重，或毫米球形范围 → 网格和报告 | 不可达目标、退化/局部翻面拒绝；左右共用目标差异超过 1 mm 拒绝；生成/拟合替换雕刻，尚非物理试穿 | [CustomTemplatePanel.vue](../../apps/desktop/src/CustomTemplatePanel.vue)，`importFile/exportFile/fit`；[MeshEditPanel.vue](../../apps/desktop/src/MeshEditPanel.vue)，`fit/morph/applySculpt` |
| F14 来源贴附，部分支持 | 从抽屉拖到可见表面，或按所选部位自动贴附；变换宽高/旋转/位置 | 来源及制作方式、可见表面/分类 → 贴附及审阅状态 | 自动跳过给原因；未确认自动位置阻止制造；变换 Enter 确认、Esc 取消；缺部位/未知侧需分类或手贴 | [AutoMappingPanel.vue](../../apps/desktop/src/AutoMappingPanel.vue)，`place/review`；[SurfacePanel.vue](../../apps/desktop/src/SurfacePanel.vue)，`dropSource/resizeAttached`；[main.ts](../../apps/desktop/main/main.ts)，`marking.auto/marking.surface/marking.surface.edit` |
| F15 模型画笔/节点，已存在 | 加色/擦除、毫米半径、笔刷形状、对称绘画、轮廓/孔洞节点和手柄 | 表面笔迹或轮廓 → 模型花纹及片内映射 | 松开保存一笔；对称两侧同次提交。空图、断岛、锁定或当前视角不可编辑时拒绝；节点草稿可取消，密集旧笔迹可转精简草稿 | [SurfacePanel.vue](../../apps/desktop/src/SurfacePanel.vue)，`beginMarkingEdit/saveDrawing/insertDrawingNode` 及画笔交互；[main.ts](../../apps/desktop/main/main.ts)，`marking.surface.brush` |
| F16 推断/记录，部分支持 | 当前 UI 可审阅已有推断、整体锁定/解锁、清空贴附；延伸/对称只有组件和请求实现，未挂入页面 | 来源、距离或 X 平面经接口 → 待审阅推断；UI 可确认已有记录 | 延伸仅填未占用整面，距离近似；对称须精确网格对应；锁定先解锁；清空保留来源和历史，可撤销。“补全侧面”按钮实际进入画笔 | [InferenceTools.vue](../../apps/desktop/src/InferenceTools.vue)，`infer`（无当前页面引用）；[main.ts](../../apps/desktop/main/main.ts)，`marking.infer`；[MarkingRecords.vue](../../apps/desktop/src/MarkingRecords.vue)，`review/lockAll/clearAll`；[SurfacePanel.vue](../../apps/desktop/src/SurfacePanel.vue)，第 9 行 |
| F17 片内/纹理花纹，部分支持 | 片内路径、来源跨缝协调编辑、UV 纹理选色、兼容二维区域贴附 | 片内轮廓/源节点/纹理种子 → 逆映射或重投影花纹 | 片内不可跨片或改变接缝交点；重投影替代人工 UV 前需确认。纹理须先接受展开，使用 512 px 代理，重复 UV 同时映射 | [MarkingEditor.vue](../../apps/desktop/src/MarkingEditor.vue)，`save/saveSource`；[TexturePanel.vue](../../apps/desktop/src/TexturePanel.vue)，`extract`；[LegacyProjection.vue](../../apps/desktop/src/LegacyProjection.vue)，`attach` |

## 裁切、拼接与制版

| ID / 状态 | 入口与操作 | 输入 → 输出 | 失败、取消与恢复 | 源码证据 |
| --- | --- | --- | --- | --- |
| F18 裁线与范围，已存在 | 曲面钢笔绘制/编辑、启用、改名/删除；选面分区、锁定/清除边界；高级半侧/中线 | 曲面点及闭合/开放路径、面集合、侧别/轴/位置 → 裁线/分区/制版范围 | 闭合至少 3 点、开放至少 2 点；断开/分叉/重走不可保存；草稿先保存或取消才能算。绘制部件仅限制手绘，不缩小自动计算范围；半侧可设镜像双片或对折零间距边 | [SurfaceCutPanel.vue](../../apps/desktop/src/SurfaceCutPanel.vue)，`metadata/remove/apply/pathWarning`；[SurfacePanel.vue](../../apps/desktop/src/SurfacePanel.vue)，`beginCurve/saveCurve/assignRegion/lockBoundary/clearCuts` |
| F19 候选与采用，部分支持 | 自动计算、模型/二维审阅、确认保存 | 模型、已审阅花纹、裁线、颜色分片/展开设置 → 独立候选及失真/补缝报告；确认后为当前裁片 | 可取消，等后台退出；超时保留已提交项目；间距变动须重算；超阈值失真需审阅。可加必要补缝，不保证缝最少或直接可制作 | [UnwrapTools.vue](../../apps/desktop/src/UnwrapTools.vue)，`unwrap/accept/allowanceRecomputeRequired`；[main.ts](../../apps/desktop/main/main.ts)，`surface.unwrap/surface.accept/surface.cancel` |
| F20 裁切版本库，已存在 | 搜索、预览、载入/删除历史版、导出 ZIP | 确认时的模型/花纹/版型快照 → 可恢复版本 | 载入恢复所需资源，可撤销；活动版本不可直接删除；当前编辑不改历史；导出某历史版会先载入它 | [CutLibraryPanel.vue](../../apps/desktop/src/CutLibraryPanel.vue)，`load/remove/exportCut`；[repository.ts](../../apps/desktop/main/repository.ts)，`cutting.activate/cutting.delete` |
| F21 拼接检查，部分支持 | 选候选/当前/历史，逐片显示、选择、分解/还原、查看接缝 | 实际裁片绑定 → 三维位置重建、缺失/失效提示 | 缺片留缺口，失效片隐藏；完整性不符要求重算；候选标明未确认；无布料张力、缝合变形或穿着模拟 | [AssemblyPage.vue](../../apps/desktop/src/AssemblyPage.vue)，`source/integrity/available/missingSeams`；[CutAssemblyPreview.vue](../../apps/desktop/src/CutAssemblyPreview.vue) |
| F22 二维编辑，已存在 | 简单预览/移动/测量/90°旋转；高级属性、节点/曲线、孔洞、布尔、路径修剪连接、标签/剪口 | 当前片、毫米尺寸/坐标及制造属性 → 更新片和检查结果 | 几何变化可使绑定/接缝失效；开放轮廓阻止制造。布尔替换两片并可清剪口/标签；拒绝确认保留绘图草稿 | [PatternCanvas.vue](../../apps/desktop/src/PatternCanvas.vue)；[PatternProperties.vue](../../apps/desktop/src/PatternProperties.vue)；[AdvancedTools.vue](../../apps/desktop/src/AdvancedTools.vue)；[usePatternEditor.ts](../../apps/desktop/src/modules/usePatternEditor.ts)，`put/finish/up/transform` |
| F23 拼接间距，已存在 | 裁切统一 0–10 cm；高级制版统一毫米宽度/角点或逐边计算 | 宽度或逐边常量/采样值/来源 → 裁剪轮廓；逐边先生成待采用结果 | 统一应用替换逐边差异，可撤销；历史保持原快照；逐边可取消/丢弃，采用须来源有效；0 表示不加 | [UnwrapTools.vue](../../apps/desktop/src/UnwrapTools.vue)，`applyAllowance`；[AllowancePanel.vue](../../apps/desktop/src/AllowancePanel.vue)，`candidate`；[JobsPanel.vue](../../apps/desktop/src/JobsPanel.vue)，`action` |
| F24 材料，已存在 | 高级材料页新建/保存版本、关联/解除、删除未使用材料 | 类别、厚度/毛长/补偿/间距、方向/转角、公差/伸长比和来源 → 版本及片关联 | 更新使排料失效；引用含源库、非活动模型、历史/候选。毛长/弹性仅记录，补偿须在模板显式采用，不自动缩放或试穿 | [MaterialsPanel.vue](../../apps/desktop/src/MaterialsPanel.vue)，`save/assign/detach/remove`；[dependencies.ts](../../packages/manufacturing/dependencies.ts)，`materialInUse` |
| F25 接缝/剪口，已存在 | 高级接缝页配两条缝线边/区间，设方向/吃量/公差/锁定 | 边引用 → 长度报告和接缝；有效时生成配对剪口 | 残差为 A长−B长−吃量的绝对值；边界变动重检，拓扑变动可失效；锁定先解锁，不匹配或失效不可生成配对剪口 | [SeamsPanel.vue](../../apps/desktop/src/SeamsPanel.vue)，`add/put/notches`；[seams.ts](../../packages/manufacturing/seams.ts)；[main.ts](../../apps/desktop/main/main.ts)，`seam.notches` |
| F26 排料，部分支持 | 高级幅宽/长度、边距/片距、毛向、保留锁定；计算后手调实例 | 按材料/数量生成实例 → 分材料布局、利用率和漏件原因 | 可选轮廓/包围框，不利用孔洞；手调仍校验。源片变动须重算，漏件或来源过期拒绝排料输出 | [NestingPanel.vue](../../apps/desktop/src/NestingPanel.vue)，`run/saveManual`；[export.ts](../../apps/desktop/main/export.ts)，`layout` |
| F27 打印/制造输出，已存在 | 勾选裁片、总览/单片分页、选页打印/PDF；顶部整单 SVG/PDF/PNG/DXF | 有效片、警告确认、纸张/布局 → 1:1 输出、100 mm 尺、页号/定位；PNG 标 144 DPI | 错误阻止输出，警告须确认；修订/纸张变化关闭旧预览；取消选择不写本次文件。驱动须实际大小，实测尺长 | [CutSelection.vue](../../apps/desktop/src/CutSelection.vue)，`output/showPreview`；[PrintPreview.vue](../../apps/desktop/src/PrintPreview.vue)；[App.vue](../../apps/desktop/src/App.vue)，`exportFile`；[main.ts](../../apps/desktop/main/main.ts)，`patterns.output/export.create`；[print-pages.ts](../../packages/manufacturing/print-pages.ts) |
| F28 制作流/交换，已存在 | 高级制作流程记标题/备注/完成状态、跳转对象；JSON/ZIP 交换 | 节点/项目 ↔ 制作流 JSON；裁片/资源 ↔ ZIP | 导入新建本地项目，保留原项目；节点完成不替代检查；未达制造条件的 ZIP 仍可保存可编辑内容，不能把归档预览当合格输出 | [WorkflowPage.vue](../../apps/desktop/src/WorkflowPage.vue)，`save/exchange/editNode`；[workflow-exchange.ts](../../apps/desktop/main/workflow-exchange.ts)，`workflowBytes/cutBundle/readWorkflow/readCutBundle`；[main.ts](../../apps/desktop/main/main.ts)，`workflow.file/patterns.bundle` |

## 助手与检查

| ID / 状态 | 入口与操作 | 输入 → 输出 | 失败、取消与恢复 | 源码证据 |
| --- | --- | --- | --- | --- |
| F29 AI 配置/本机桥，部分支持 | 管理模型/提供商/技能/MCP；软件连接开关接外部本机助手 | 地址/密钥/模型标识/技能/MCP → 本机配置、模型/工具名称；本机桥接受限 CAD 请求 | 设置草稿独立撤销重做；MCP 只初始化/列工具；无内置对话代理、推理执行器或 `tools/call`。桥启用才可连，令牌本次启动有效；关闭后拒绝新请求及未执行的排队请求，已开始操作不承诺中止 | [AssistantPage.vue](../../apps/desktop/src/AssistantPage.vue)，`run/save/testMcp`；[AssistantModels.vue](../../apps/desktop/src/AssistantModels.vue)；[AssistantConnection.vue](../../apps/desktop/src/AssistantConnection.vue)，`toggle`；[assistant-settings.ts](../../apps/desktop/main/assistant-settings.ts)，`models/mcpTest`；[assistant-bridge.ts](../../apps/desktop/main/assistant-bridge.ts)，`assistantMethods/assistantCommands` |
| F30 检查/任务，已存在 | 检查与记录、任务活动区、错误横幅 | 几何/材料/绑定/花纹/接缝问题和任务 → 定位、排队/运行/待采用/过期等状态 | 页面错误按范围保留；旧响应不能覆盖新编辑；取消失败提示重试，成功仍等任务返回；只读刷新不占写锁 | [App.vue](../../apps/desktop/src/App.vue)，`navigateIssue/scheduleRefresh`；[store.ts](../../apps/desktop/src/store.ts)，`run/cancelRun/refresh`；[TaskActivity.vue](../../apps/desktop/src/TaskActivity.vue)；[JobsPanel.vue](../../apps/desktop/src/JobsPanel.vue) |
| F31 三维查看，已存在 | 中键旋转、平移/缩放、预设方向/聚焦；显示菜单切线框、纹理/片色、透视、阴影、热图及裁线 | 相机/显示选项及有效绑定 → 可交互预览、失真颜色和含花纹记录的面数 | 显示缩放不改网格；大网格可降细节，精确拾取仍用原模型；GPU 失败可重试或用简化色网格。含记录的面数不表示每面完整覆盖；灰色热图表示无数据 | [SurfacePanel.vue](../../apps/desktop/src/SurfacePanel.vue)，`preset/resetView/changeZoom/highlightUnmarked/gpuLost/heatmap`；[SurfaceGpu.vue](../../apps/desktop/src/SurfaceGpu.vue) |

## 测试线索与未验收范围

制作交付另有边界：数量是总份数，镜像只影响交替实例；当前输出只有一个有效方向箭头，接缝检查也不证明所有应缝边均已配对。左右／正反面、层次、省道／拉链工艺和实例装配说明的现有支持与人工补充方法见[版片交付规格](pattern-delivery.md)。这些要求不能从 F22–F28 的接口存在或成功导出直接推导为已完成。

这些文件提供现有覆盖入口，本次只读，不报告通过率。命令和依赖见[测试索引](../../tests/README.md)。

| 功能 | 已有测试线索 |
| --- | --- |
| 项目/历史/取消 | [recovery-e2e.mjs](../../tests/recovery-e2e.mjs)、[source-draft-history-e2e.mjs](../../tests/source-draft-history-e2e.mjs)、[review-transient-errors.test.ts](../../tests/integration/review-transient-errors.test.ts)、[output-dialog-order.test.ts](../../tests/integration/output-dialog-order.test.ts) |
| 原图/库/细节 | [reference-sheet-desktop-e2e.mjs](../../tests/reference-sheet-desktop-e2e.mjs)、[library-metadata-registration.test.ts](../../tests/integration/library-metadata-registration.test.ts)、[detail-fabrication-state-independent.test.ts](../../tests/integration/detail-fabrication-state-independent.test.ts) |
| 模型/模式 | [model-generation-modes-ui.test.ts](../../tests/integration/model-generation-modes-ui.test.ts)、[model-transform.test.ts](../../tests/model-transform.test.ts)、[model-sizing-ui-e2e.mjs](../../tests/model-sizing-ui-e2e.mjs) |
| 映射/裁切 | [mapping-edit-history-e2e.mjs](../../tests/mapping-edit-history-e2e.mjs)、[model-surface-workflow-e2e.mjs](../../tests/model-surface-workflow-e2e.mjs)、[topology-provenance.test.ts](../../tests/integration/topology-provenance.test.ts)、[cut-material-history-dependencies-independent.test.ts](../../tests/integration/cut-material-history-dependencies-independent.test.ts) |
| 制版/打印 | [material-history.test.ts](../../tests/integration/material-history.test.ts)、[simple-manufacturing-ui.test.ts](../../tests/integration/simple-manufacturing-ui.test.ts)、[production-panel-state.test.ts](../../tests/integration/production-panel-state.test.ts)、[print-pages-e2e.mjs](../../tests/print-pages-e2e.mjs) |
| 助手 | [assistant-settings.test.ts](../../tests/integration/assistant-settings.test.ts)、[assistant-settings-review.test.ts](../../tests/integration/assistant-settings-review.test.ts)、[assistant-bridge.test.ts](../../tests/integration/assistant-bridge.test.ts) |

真实图分类/覆盖、特殊姿势贴附、缝线可制作性、材料试样、长任务恢复和打印机比例仍需按[统一验收](../planning/requirements.md)执行。ONNX 推理、真实布料模拟、第三方可执行插件、账号/计费和云同步见[后续规划](../planning/roadmap.md)。

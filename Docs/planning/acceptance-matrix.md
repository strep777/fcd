# 需求、功能与验收矩阵

整理日期：2026-10-26；源码基准 `0bd71c8`。对应[需求规格](requirements.md)的 FR-01–31、PR-01–08、NFR-01–09 和[功能清单](../guides/feature-catalog.md)的 F01–F31。**本次是只读源码与文档核对，以下功能验收均未在本次执行。** 测试文件只是可用入口，不代表该文件已经覆盖一行中的所有预期，也不代表当前工作区通过。

执行环境、真实 Rust worker、隐藏桌面及记录方式见[开发与验证](../guides/development-and-validation.md)和[测试索引](../../tests/README.md)。本文不新增安全测试范围，重点是功能结果、失败后状态和实现表现。

## 验收层次

| 层次 | 证明什么 | 不能代替什么 |
| --- | --- | --- |
| A 文档／静态 | 需求映射、文件链接、类型及构建诊断 | 实际用户操作和制作效果 |
| B 领域／事务 | 输入到结果、拒绝条件、版本和资源一致性 | 真实桌面交互、GPU 显示和打印机行为 |
| C 原生几何 | 真实 worker 的覆盖、长度、失真、对应和取消 | 材料弹性、缝合外形或舒适性 |
| D 桌面流程 | 页面、输入、后台、保存／重开及错误反馈能连通 | 对最终文件尺寸和实物的独立判断 |
| E 输出回读 | SVG/PDF/DXF/归档的几何、单位、页码与资源正确 | 打印驱动缩放和实际材料制作 |
| F 实物试样 | 纸样比例、缝制对位、毛向、填充外形与穿戴适用性 | 所有未测试材料、体型和部位 |

验收报告写出实际达到的层次。通过 A–E 时可以确认软件和文件流程，只有对应材料／部位完成 F 后才可声称该样本的制作效果已经验证。

## 功能验收清单

| 验收编号 / 需求 | 操作与独立预期 | 必查失败／边界 | 已有测试入口示例 |
| --- | --- | --- | --- |
| AT-01 / FR-01–03 | 新建两个项目，编辑、保存、切换、重开、撤销及恢复；比对几何、资源和各项目历史 | 取消打开／保存、无效文件、修订冲突；恢复后再撤销；删除会话不删外部文件 | [recovery-e2e](../../tests/recovery-e2e.mjs)、[session-deletion-e2e](../../tests/session-deletion-e2e.mjs)、[repository](../../tests/integration/repository.test.ts) |
| AT-02 / FR-04、30 | 沿八阶段完成一次主线，切换简单／高级、语言和分栏；问题能定位，任务状态与实际一致 | 未保存草稿离页、旧请求晚返回、取消失败后重试；模式跨启动不作已支持断言 | [workflow-pages-e2e](../../tests/workflow-pages-e2e.mjs)、[session-drafts-e2e](../../tests/session-drafts-e2e.mjs)、[session-task-activity](../../tests/integration/session-task-activity.test.ts) |
| AT-03 / FR-05 | 用完整多视图设定图提取，逐区域比对独立标注的色块、孔洞、细节、部位与左右；记录误选／漏选 | 深色身体与描边、相近色、阴影、遮挡、独立小岛；重新提取及取消 | [reference-sheet-independent](../../tests/integration/reference-sheet-independent.test.ts)、[reference-sheet-desktop-e2e](../../tests/reference-sheet-desktop-e2e.mjs) |
| AT-04 / FR-06 | 已知像素距离对应 100 mm，校验来源实际尺寸；更改标定检查旧贴附处理 | 重合点、零／负距离、未保存标定、锁定贴附 | [reference-workflow-e2e](../../tests/reference-workflow-e2e.mjs)、[reference](../../tests/integration/reference.test.ts) |
| AT-05 / FR-07 | 颜色、钢笔、套索分别选区，加入孔洞，草稿撤销重做后确认入库；单次确认只写一次 | 未闭合、相交、超预算；独立候选过期／未接受不进入正式库 | [reference-autoaccept](../../tests/integration/reference-autoaccept.test.ts)、[reference-candidate](../../tests/integration/reference-candidate.test.ts)、[reference-candidate-controls-e2e](../../tests/reference-candidate-controls-e2e.mjs) |
| AT-06 / FR-08 | 搜索／分类／多选来源，改变左右和制作方式；detail 保留可见轮廓且不单独成为缝制材料域 | unknown 保留；删除未锁定来源同步移除关联贴附及派生推断，可撤销且保留裁切历史；锁定关联阻止整批删除，失败状态完整；同颜色不同制作方式不能误合并 | [library-metadata-registration](../../tests/integration/library-metadata-registration.test.ts)、[detail-fabrication-state-independent](../../tests/integration/detail-fabrication-state-independent.test.ts) |
| AT-07 / FR-09 | 补画、擦除、钢笔和节点修形；与原始像素／独立边界比对，再检查关联贴附 | 擦空、断岛、锁定／失效关联、保存失败仍留草稿；原来有效邻区不因修补变坏 | [source-draft-history-e2e](../../tests/source-draft-history-e2e.mjs)、[shared-contour-local-fallback](../../tests/integration/shared-contour-local-fallback.test.ts)、[contour-independent-acceptance](../../tests/integration/contour-independent-acceptance.test.ts) |
| AT-08 / FR-10–11 | 导入已知尺寸 OBJ/GLB，生成三种模式，独立量尺寸与开口；多模型切换恢复各自状态 | 错单位、非三角／退化输入、unknown 部位、非对称姿态；padded 不应多出头手脚 | [model-generation-modes-ui](../../tests/integration/model-generation-modes-ui.test.ts)、[model-surface-workflow-e2e](../../tests/model-surface-workflow-e2e.mjs) |
| AT-09 / FR-12–13 | 整体／部位／顶点变换，测量拟合、Morph、局部雕刻；独立测量目标和变动范围 | 不可达目标、局部翻面、自由缩放后的报告、绑定失效；撤销恢复原几何 | [model-transform](../../tests/model-transform.test.ts)、[custom-template](../../tests/integration/custom-template.test.ts)、[model-sizing-ui-e2e](../../tests/model-sizing-ui-e2e.mjs) |
| AT-10 / FR-14 | 手贴及自动贴附后旋转检查前后左右，调整位置和宽高，审阅后进入裁切 | 缺分类／未知侧／背面遮挡、跳过原因；未审阅位置阻止制造，Enter／Esc 行为区分 | [mapping-edit-history-e2e](../../tests/mapping-edit-history-e2e.mjs)、[mapping-cut-lifecycle](../../tests/integration/mapping-cut-lifecycle.test.ts) |
| AT-11 / FR-15 | 多尺度画笔、擦除、对称笔画、孔洞和节点编辑；独立检查表面位置及同次撤销 | 断岛／空图、锁定、不可编辑视角、取消草稿；对称一侧失败不能只写另一侧 | [surface-free-brush](../../tests/integration/surface-free-brush.test.ts)、[surface-marking-edit](../../tests/integration/surface-marking-edit.test.ts) |
| AT-12 / FR-16 | 用已有或接口推断记录审阅、锁定、解锁、清空；“补全侧面”进入手工画笔 | 未审阅不能制造；清空保留源库和历史；不把未挂载组件测试算作当前 UI 可达 | [marking-completion](../../tests/integration/marking-completion.test.ts)、[inference-e2e](../../tests/inference-e2e.mjs)（执行前核对当前路由） |
| AT-13 / FR-17 | 片内编辑回映三维；跨缝改来源；纹理种子沿已接受 UV 分割 | 跨片、接缝交点改变、重复 UV、代理漏细节、重投影覆盖人工修改 | [surface-texture-lifecycle](../../tests/integration/surface-texture-lifecycle.test.ts)、[workflow-projection](../../tests/integration/workflow-projection.test.ts) |
| AT-14 / FR-18 | 绕模型画开放／闭合线、编辑启停、面分区和半侧；保存后重开仍为相同路径 | 分叉、断开、重走、未提交草稿；绘制部位不冒充计算范围；对折边规则 | [cut-path-contract](../../tests/integration/cut-path-contract.test.ts)、[cut-line-workflow](../../tests/integration/cut-line-workflow.test.ts)、[cut-tools-e2e](../../tests/cut-tools-e2e.mjs) |
| AT-15 / FR-19 | 真实 worker 从模型与花纹算候选，核对原表面覆盖、材料并集／补集、三维对应、接缝和失真，再确认 | 细小／触碰／交错材料域、孔洞、补缝、超预算、过期、取消、间距改变、未审阅；失败不改当前版 | [current-design-cut-regression](../../tests/integration/current-design-cut-regression.test.ts)、[cut-candidate-dependency-acceptance](../../tests/integration/cut-candidate-dependency-acceptance.test.ts)、[independent-cut-correspondence](../../tests/independent-cut-correspondence.mjs) |
| AT-16 / FR-20 | 接受两版、改当前模型／材料／花纹、载入旧版，核对旧版全套资源及撤销 | 禁删活动版；导出历史版先载入行为可见；当前编辑不得改历史；重开仍可恢复 | [cut-material-history-dependencies-independent](../../tests/integration/cut-material-history-dependencies-independent.test.ts)、[model-accepted-cut-restore](../../tests/integration/model-accepted-cut-restore.test.ts) |
| AT-17 / FR-21 | 候选／当前／历史逐片显示和分解，由实际片重建位置；与三维对应审计比对 | 删除一片应留缺口，失效片不渲染成完整原模型；错误完整性须提示 | [assembly-integrity](../../tests/integration/assembly-integrity.test.ts)、[assembly-archive-integrity-e2e](../../tests/assembly-archive-integrity-e2e.mjs) |
| AT-18 / FR-22 | 修改二维曲线、孔洞、布尔／连接／修剪及数量、标签、剪口；独立检查轮廓和选中范围 | 开放轮廓、布尔替换附属信息、绑定失效、取消确认留草稿；镜像与旋转保持单位 | [advanced-e2e](../../tests/advanced-e2e.mjs)、[simple-manufacturing-ui](../../tests/integration/simple-manufacturing-ui.test.ts) |
| AT-19 / FR-23 | 统一及逐边缝份，直角／凹角／曲线／孔洞与对折边逐项比对裁剪线、缝线 | 0 宽、输入单位、统一覆盖逐边、取消任务、候选过期；不改历史快照 | [manufacturing-e2e](../../tests/manufacturing-e2e.mjs)、[pattern-spacing-cancel-e2e](../../tests/pattern-spacing-cancel-e2e.mjs)、[color-cut-allowance-partition](../../tests/integration/color-cut-allowance-partition.test.ts) |
| AT-20 / FR-24 | 建材料版本并关联裁片，改变方向／公差后检查排料及依赖，再解除／删除 | 当前、源库、非活动模型、历史、候选引用逐类阻止删除；材料记录不自动缩放纸样 | [materials](../../tests/integration/materials.test.ts)、[material-history](../../tests/integration/material-history.test.ts) |
| AT-21 / FR-25 | 配对边及子区间，设方向、吃量、公差后独立量长，生成剪口并核对对应 | 不匹配、反向、锁定、拓扑变化和过期；需量缝线而非缝份外缘 | [seams](../../tests/integration/seams.test.ts)、[current-revision-seams-e2e](../../tests/current-revision-seams-e2e.mjs)、[seam-provenance-acceptance](../../tests/integration/seam-provenance-acceptance.test.ts) |
| AT-22 / FR-26 | 多材料、镜像／数量和毛向约束排料，保留锁定并手调；独立检查实例数量、碰撞、边距 | 漏件、片变动、超幅、方向违规；不要求孔洞填充或全局最优 | [nesting](../../tests/integration/nesting.test.ts)、[manufacturing-e2e](../../tests/manufacturing-e2e.mjs) |
| AT-23 / FR-27 | 指定批次及页码输出，独立解析 SVG/PDF/DXF，核对片数、毫米尺寸、页定位和 100 mm 尺，再真实打印 | 旧预览、取消对话框、警告未审阅、过期布局、打印“适合页面”；PNG 144 DPI 元数据 | [print-scale](../../tests/integration/print-scale.test.ts)、[print-pages-e2e](../../tests/print-pages-e2e.mjs)、[output-dialog-order](../../tests/integration/output-dialog-order.test.ts) |
| AT-24 / FR-28 | 记录工作流并导出 JSON／ZIP，在新项目导入后核对节点、片和资源 | 导入不覆盖原项目；归档可编辑内容不冒充可制造输出；断资源明确失败 | [workflow-independent-review](../../tests/integration/workflow-independent-review.test.ts)、[workflow-audit-e2e](../../tests/workflow-audit-e2e.mjs) |
| AT-25 / FR-29 | 配置草稿撤销重做、保存并列模型／MCP 工具；启停本机桥，执行允许的 CAD 操作 | 无网络／错误连接不影响离线 CAD；无内置推理及 `tools/call` 不作成功断言；关闭后拒绝新请求及未执行的排队请求，已开始操作不承诺中止 | [assistant-settings](../../tests/integration/assistant-settings.test.ts)、[assistant-settings-review](../../tests/integration/assistant-settings-review.test.ts)、[assistant-bridge](../../tests/integration/assistant-bridge.test.ts) |
| AT-26 / FR-31 | 旋转、平移、聚焦、缩放、显示切换及 GPU 失败回退；对同一点验证原模型拾取 | 大网格降细节不改数据；无失真数据为灰色；有花纹记录面不等于全覆盖；视图截断不丢片 | [surface-display-lod](../../tests/integration/surface-display-lod.test.ts)、[surface-rendering](../../tests/integration/surface-rendering.test.ts)、[picking-e2e](../../tests/picking-e2e.mjs) |

## 整套纸样的交付验收

这些检查在全部功能编辑完成后集中执行，使用同一版本、同一候选接受后的项目和最终导出文件。详细操作与当前限制见[版片交付规格](../guides/pattern-delivery.md)。

| 验收编号 / 需求 | 检查方式 | 不通过的情形 |
| --- | --- | --- |
| MC-01 / PR-01 | 明确各套纸样对应的身体、填充、衬里或外覆层；对照模型和材料逐片检查连接对象 | 把 padded 模型直接当成已交付内胆与外覆两套纸样，或层次／连接对象不明 |
| MC-02 / PR-02 | 导出后按片 ID／名称、实例号、左右、正反面与版本重建完整清单；核对三维对应 | 只有通用编号而无法区分左右实例；以模型侧别替代纸面说明；混用两个修订输出 |
| MC-03 / PR-03 | 逐项核对总数和镜像份数；至少检查数量 1、2、4 的镜像行为；核对材料关联、旋转和箭头 | 数量被当作对数、数量 1 被误认为自动成对、镜像／旋转后方向错、双方向只显示一支却没有说明 |
| MC-04 / PR-04 | 分别读取净样、裁剪线和孔洞；核对统一／逐边／零缝份；检查所有参考线用途 | 把内部车线当裁剪边、孔洞消失、用裁剪线量接缝、逐边例外无法识别 |
| MC-05 / PR-05 | 人工枚举全部应缝边和保留开口，逐实例核对配对、起止、方向及剪口顺序，再检查已有接缝报告 | 无错误报告但仍漏配边；多个镜像实例对象不明；孔口误缝闭或不同版本剪口混用 |
| MC-06 / PR-06 | 核对省道、省口、拉链和连接件说明，确认图纸或随附说明保留止点、留量与装配方法 | 只有几何缺口没有工艺定义；把制作流备注当作已经印到纸上；不能解释开放边用途 |
| MC-07 / PR-07 | 独立核对完整材料覆盖、锁定缝和局部失真，并按来源判定小片；评估可裁剪／可对位／可缝制性 | 删除真实小岛以降片数、内部网格边全部成缝、数值通过但留下无来源碎片或无法操作的片形 |
| MC-08 / PR-08 | 回读最终文件，核对整组内容和 100 mm 尺，再打印实测及指定材料／部位试样 | 打印缩放错误、文字／实例遗漏、图纸不能装配；以几何预览代替实物记录 |

当前缺少的结构化工艺对象允许由清晰的人工说明补足；没有说明或无法核对时仍记为未完成。每类材料和部位的实物结论只适用于对应样本。

## 跨流程状态与性能验收

| 需求 | 必须组合覆盖的状态 | 证据或现有入口 |
| --- | --- | --- |
| NFR-01 单位 | 原图标定 → 模型 → 裁片 → 旋转／缩放视图 → 输出 → 实际打印 | 独立几何尺寸和打印尺照片；[print-scale](../../tests/integration/print-scale.test.ts) |
| NFR-02 事务 | 正常提交、错误修订、命令失败、同请求重放、撤销／重做、恢复后撤销 | 项目、修订、commands／requests、恢复点前后对照；[repository-checkpoint](../../tests/integration/repository-checkpoint.test.ts) |
| NFR-03 依赖 | 有效、预先失效、未审阅三组分别做精确细分、来源修改、模型变更、候选采用 | 独立规范化哈希及结果；[topology-provenance](../../tests/integration/topology-provenance.test.ts)、[cut-candidate-provenance](../../tests/integration/cut-candidate-provenance.test.ts) |
| NFR-04 历史资源 | 活动与非活动模型、旧裁切版、恢复点、运行／待采用候选、删除和垃圾回收 | 重开和恢复所需资源均在；[repository-resource-dedup](../../tests/integration/repository-resource-dedup.test.ts)、[material-history](../../tests/integration/material-history.test.ts) |
| NFR-05 离线 | 无网络启动、编辑、原生计算、保存重开、输出；助手关闭和连接失败 | [offline-e2e](../../tests/offline-e2e.mjs)及同构建桌面实测 |
| NFR-06 预算／取消 | 队列中取消、运行中取消、临近结果取消、超时、超限、错误后再次正常任务 | 原任务退出、迟到结果不写入、队列可继续；[worker-cancellation-lifecycle](../../tests/integration/worker-cancellation-lifecycle.test.ts)、[surface-runtime-budget](../../tests/integration/surface-runtime-budget.test.ts)、[late-cancel-e2e](../../tests/late-cancel-e2e.mjs) |
| NFR-07 恢复体验 | 未保存来源／裁线／节点草稿，切页／切项目、失败、关闭与重开 | 保存／放弃／返回和错误位置；[session-drafts-e2e](../../tests/session-drafts-e2e.mjs)、[recovery-e2e](../../tests/recovery-e2e.mjs) |
| NFR-08 兼容 | 当前归档往返、可迁移旧样本、无法支持版本、缺失资源／错误内容 | 原文件未改、明确失败或迁移记录；[resources-e2e](../../tests/resources-e2e.mjs)、[corrupt-session-e2e](../../tests/corrupt-session-e2e.mjs) |
| NFR-09 可复现 | 每次结果绑定相同源码、worker、桌面构建及输入；复跑保留失败记录 | [证据字段](../guides/development-and-validation.md)及 `test-results/` 下本次报告 |

性能样本至少覆盖：小型单片、常用身体模型、复杂多色边界、接近任务预算的输入。记录冷启动／已有缓存、排队等待／实际求解、首个可操作界面时间、峰值内存和取消到退出的时间。不要将缓存复用耗时写成首次求解耗时。现阶段不填写未测得的“几秒完成”或“不卡顿”结论。

## 制作主线样本

以下是需要冻结输入的验收样本类型，不表示仓库已包含每一份可用实物或授权素材。

| 样本编号 | 输入及目的 | 交付证据 |
| --- | --- | --- |
| S01 尺寸基准 | 有已知毫米尺寸的平面／圆柱／曲面小样，含孔洞和两条配对缝 | 几何数值、三维二维往返、导出回读及纸面尺实测 |
| S02 整张角色图 | 正背／侧视、深浅材料、细小高光、描边和遮挡；人工标注制作方式 | 原图哈希、独立区域标注、提取误差／手修记录、映射审阅 |
| S03 填充衣身 | 明确人体测量和 padded 外形，含胯部／腿部曲率及五个开口 | 生成实测、结构线、省道／补缝、全套纸样、拼接和试缝 |
| S04 复杂材料边界 | 同色不连通区域、触碰边、孔洞、小岛和跨结构缝花纹 | 材料域独立覆盖／互斥检查、共享边对位、无非预期碎片 |
| S05 手工修版 | 一组需要改裁线、改曲线和改缝份的可重放项目 | 草稿到保存、候选到采用、接缝重检、撤销和输出结果 |
| S06 历史与恢复 | 含两个模型、两个裁切版本、材料版本和源图的项目 | 编辑当前、恢复旧版、重开、取消／失败后资源完整及状态对照 |

参考 R01–R19 作为视觉意图对照，不替代 S01–S06 的源几何、实测或独立预期。图示没有尺寸时不能据此计算误差；缺少相应源模型时应记录“该参考效果未实测”。头、手爪、脚和尾应各加专门样本，不能以衣身通过代表所有部位通过。

## 独立几何和制作检查方法

1. 从原始表面与人工确认的材料域出发核对覆盖与互斥。分别检查漏面、重复面、小孔、材料归属和方向，不能只比较总面积，因为漏失和重复可能相互抵消。
2. 以绑定回到原三维三角面，核对重心坐标、片边与裁线位置；按原曲面路径测接缝，不用同一个输出函数重复计算作为唯一预期。
3. 分别报告面积、边长、角度和组合失真，关注最坏局部和 P95。检查翻面、自交、片内重叠及孔洞，不能仅凭平均值通过。
4. 量接缝的缝线及所选区间，按方向核对剪口；有吃量时使用明确的长度差定义。缝份外缘用于裁剪，不能拿它替代缝线配对。
5. 对最终导出独立解析单位、片数、标签、页覆盖和定位；以打印纸实测 100 mm 校验尺。纸面正确后再用指定材料试缝，记录毛向、配对、填充与活动反馈。

当数值通过但出现过多小片、难缝尖角、不可装配缝或明显外形偏差时，该制作样本仍未通过；记录原因，回到对应的裁线、材料、拟合或修版需求。不能仅调宽阈值消除报告。

## 发布和本次文档验收

当前仓库保留了[已报告流程的验收说明](../../tests/reported-functional-acceptance-contract.md)，涉及整图提取、五开口衣身、自动贴附、实际 UI 裁切和下游输出。它是既有任务证据，不是本轮重新执行的结果。说明中的 10–50 片目标和小于 100 mm² 片的来源支持条件只适用于指定报告样本；不能推广为全部模型的固定片数或通用最小片面积。

引用既有结果时，应区分历史完整基线、后续受影响文件复测和各阶段桌面构建；已有记录没有替代本页 MC-01–08 的全套工艺及实物验收。

功能发布应在相关功能完成后集中执行：必要静态检查 → 真实原生算法／状态回归 → 同一构建的桌面主线 → 输出回读 → 约定实物样本。默认 `verify` 与 `test:desktop` 的范围不同，需按[命令说明](../guides/development-and-validation.md)补齐；无法执行的范围标为未执行，不换成较简单样本后声称原样本通过。

本次文档交付只检查：源码事实与状态边界、19 张参考图全量索引、FR／F／AT 对应、本地链接、差异格式和只读源码基线。实际结果记录在 `test-results/documentation-audit/` 与本次 `update/` 说明中。未来软件验收必须另建执行记录，不能沿用本页作为通过证书。

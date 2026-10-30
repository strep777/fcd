# 项目数据与契约

基准日期：2026-10-26。应用版本：0.8.0；基准提交 `0bd71c8c4d460fe44663ebee5cc484218d8b0e38`。本文以当前工作区为准，本次未执行迁移、归档往返或数据库恢复测试。

[packages/schema/index.ts](../../packages/schema/index.ts) 的 Zod 模式是字段、类型和结构限制的依据。本文解释数据归属与业务边界，不复制全部模式。运行链见[桌面应用架构](architecture.md)，文件使用见[制作流程](../guides/user-workflow.md)。

## 版本与格式各管什么

| 标识 | 当前值与入口 | 含义 |
| --- | --- | --- |
| 应用版本 | 0.8.0，根 `package.json`、Tauri 配置、归档写入器 | 应用及分发版本，不等于工程结构版本 |
| 项目结构 | `schemaVersion: 2`，`projectSchema` | 规范化后的项目对象 |
| 请求协议 | `protocolVersion: 1`，`requestSchema` | 桌面与助手 CAD 请求 |
| 工程包格式 | `format: fpcad`、`formatVersion: 1` | ZIP 容器和清单格式 |
| 制作流格式 | `format: fpcad-workflow`、`version: 1 / 2` | 内嵌完整项目，或以共享几何保存完整项目的 JSON 交换 |
| 裁片包格式 | `format: fpcad-cuts`、`version: 1` | 完整工程加可选逐片 SVG 的 ZIP |

`projectSchema` 只接受版本 2。[parseProject](../../packages/schema/index.ts) 可读取版本 1 或 2，将版本号提升到 2，再按当前模式验证；它不改写原文件或旧历史行，也没有任意版本的迁移链。只有后续明确保存或命令提交才写出新状态。兼容旧项目不能仅修改版本号，还须检查可选字段、默认语义、资源与历史依赖。

## 项目实体

项目 ID 标识工程；本地会话 ID 标识一次工作库会话，二者不同。打开同一工程文件会建立新的会话记录，不能把工程 ID 当成数据库会话主键。

| 字段 / 模式 | 作用与关联 |
| --- | --- |
| `id/name/unit/revision/createdAt/updatedAt` | 项目标识、名称、毫米单位、递增修订与时间 |
| `pieces` / `pieceSchema` | 当前二维路径或裁片，含节点、曲线、孔、材料、裁剪数量、缝份、方向、剪口及标签 |
| `references` / `referenceSchema` | 原图或视图图像、尺寸、毫米标定、原图资源和设定图分析元数据 |
| `patternLibrary` / `regionSchema` | 可编辑来源轮廓，关联 reference、视图、人物分组、部位、制作方式 |
| `maskSources` / `maskSourceSchema` | 已接受选区的掩码、标定及处理参数；纸样以 `sourceMaskId` 引用 |
| `surface` / `surfaceSchema` | 当前模型的毫米坐标、三角面、拓扑版本、部位分配、裁线、纹理和生成来源 |
| `modelLibrary` / `modelRecordSchema` | 各模型独立保存的 surface、已绑定裁片、绑定、花纹和内部接缝 |
| `markings` / `markingSchema` | 表面花纹及来源、三维碎片、二维路径、审阅和锁定状态 |
| `referenceRun` / `referenceRunSchema` | 原图计算候选；`accepted` 区分是否已接受 |
| `surfaceRun`、`previewMarkings` | 裁切/展开候选及与候选配套的花纹，不直接等同正式裁片 |
| `bindings` / `bindingSchema` | 当前二维裁片到模型的对应、来源与几何指纹、展开报告、可选裁切三角网 |
| `cuttingLibrary`、`activeCutId` | 已接受裁切的历史快照及当前显示来源 |
| `materials`、`seams`、`nesting` | 材料参数、纸样边配对、排料选项和放置结果 |
| `workflow` | 制作节点标题、备注和完成标记；标记完成不替代后台制造检查 |

`projectSchema` 检查重复 ID、重复材料名称和部分引用关系；`cutLibraryEntrySchema` 还检查快照的裁片、绑定、表面面 ID、花纹路径及接缝对应。并非所有语义都由 Zod 完成。面拓扑、来源是否过期、材料是否在用、可否制造等仍须领域校验，不能用“模式解析成功”代替完整项目验收。

### 像素、毫米和三维对应

`reference.view` 与来源 `view` 支持 `sheet/front/back`。当前新导入保留完整 `sheet`，由 `illustration.figures` 记录人物窗口，来源通过 `sourceGroup` 关联所属人物。人物建议朝向与原图视图不是同一个字段；自动位置仍须审阅。旧正背双图可读，不应因为当前界面改用整图就删掉兼容格式。对应 [placement-context.ts](../../packages/reference/placement-context.ts)。

原图坐标以像素表达。标定用两个像素点和真实 `distanceMm` 建立毫米关系；资源包含原始编码、方向和变换、解码原图指纹、代理图与缩略图。代理图用于交互或处理时，必须保留回到原图的比例与位置，不能把显示分辨率当成制作精度。

二维点使用 `xMm/yMm`，模型点使用 `xMm/yMm/zMm`。纸样曲线通过节点 ID 及控制点关联边。花纹 `fragments` 以原始面 ID 和重心坐标记录三维覆盖，`paths` 保存纸样上的毫米轮廓与几何指纹。绑定的 `trim` 可保存子三角形及到原始面的重心坐标对应。这些字段服务于正反映射和来源检查，不是布料受力模拟数据。

### 制作方式、审阅和锁定

`Piece.cutQty` 表示输出总份数，`mirror` 控制其中的交替镜像实例，不额外翻倍。`Piece` 没有专门的左右／正反面、层次角色、拉链、完整省道或通用内部工艺线字段；`Seam` 按片 ID 引用两侧边，不记录具体裁剪实例。现有文字／备注可辅助表达工艺，但不能当作这些实体已经结构化。当前输出和人工补充规则见[版片交付规格](../guides/pattern-delivery.md)。

来源轮廓与表面花纹的可选 `fabrication` 区分 `sewn`（拼缝材料）和 `detail`（印绘等细节）。旧数据未写该字段时须维持旧语义。[marking-fingerprint.ts](../../apps/desktop/main/marking-fingerprint.ts) 的 `markingFingerprint` 只为 `detail` 增加制作方式字段，保留旧拼缝数据的指纹形式；不能擅自把所有缺省字段序列化进去。

自动贴附的 `placement.reviewed` 与推断的 `inference.reviewed` 分别记录人工审阅；`locked` 控制后续编辑。它们与几何有效性、来源新鲜度各管一层约束。`markings.lockAll` 是现有确认并锁定入口，先检查花纹未过期，再更新整组审阅与推断父指纹。不得在普通重算、模型切换或恢复中自动批准推断。

## 候选到正式状态

[repository.ts](../../apps/desktop/main/repository.ts) 的 `commit` 接收内部命令并应用状态变化；[main.ts](../../apps/desktop/main/main.ts) 的 `handle` 限制普通 `command.apply` 直接提交部分派生结果。前端应调用对应业务方法，不自行组装“已求解”或“已接受”的内部命令。

原图候选接受时检查 reference 及其来源指纹，随后写来源库或当前纸样，并按需保存掩码来源。表面候选写入 `surfaceRun` 与 `previewMarkings`；接受时还需核对模型哈希、候选输入哈希、每片几何和颜色依赖、缝合质量、自动贴附/推断审阅及接缝依赖。接受成功后替换该模型的正式裁片与绑定，创建裁切快照，并清除预览与排料。

缝份/偏移候选由 [jobs.ts](../../apps/desktop/main/jobs.ts) `JobManager` 单独记录。状态集合为 `queued/running/succeeded/failed/cancelled/accepted/discarded/stale`。启动时检查算法版本；接受时校验基础修订、输入哈希、含算法版本的结果哈希及几何问题，并在同一事务更新项目、任务与恢复点。任务成功不代表已经改变正式纸样。

## 指纹与依赖

| 指纹 / 关系 | 检查内容与代码入口 |
| --- | --- |
| `surfaceHash`、`topologyVersion` | 模型内容和拓扑版本；[surface.ts](../../apps/desktop/main/surface.ts) 的 `bindingIssues` 检查绑定是否适用 |
| `geometryHash` | 纸样几何；`pieceGeometryHash` 是相关后台入口 |
| `colorHash` | 裁切涉及的花纹颜色/覆盖依赖；`cutColorHash` 统一计算 |
| `surfaceRun.inputHash` | 候选所用项目输入；[cut-candidate.ts](../../apps/desktop/main/cut-candidate.ts) 的 `cutCandidateInputHash` |
| `inference.sourceFingerprint` | 父花纹的稳定依赖；[marking-fingerprint.ts](../../apps/desktop/main/marking-fingerprint.ts) 的 `markingFingerprint` |
| 来源图与轮廓指纹 | [reference/resources.ts](../../packages/reference/resources.ts) 的 `referenceKey` 以及后台来源校验 |
| 材料引用 | [manufacturing/dependencies.ts](../../packages/manufacturing/dependencies.ts) 的 `projectPieces/materialInUse` |

材料删除检查当前纸样、来源库、非活动模型、原图候选、表面候选及裁切历史。只查看当前页面会漏掉可恢复状态。材料修改要求版本连续递增，并同步当前纸样显示名称。

[project-lifecycle.ts](../../apps/desktop/main/project-lifecycle.ts) 的 `saveActiveModel` 在提交前后维护模型记录，`assertModelDetach` 防止模型切换丢失跨边界接缝。[cutting-library.ts](../../apps/desktop/main/cutting-library.ts) 的 `archiveCut` 深拷贝已接受状态；`activateCut` 校验快照来源后恢复，不覆盖当前来源轮廓库。旧快照花纹使用 `source: cut-library` 和快照指纹继续识别其来源，不能要求它重新依赖已被修改或删除的活动来源轮廓。

精确节点细分和元数据变化有专门重映射规则。维护者必须同时检查此前有效、此前失效和未审阅情况；不能统一重写指纹后将全部依赖视为有效。

## SQLite 工作库

[Repository](../../apps/desktop/main/repository.ts) 使用以下表。这里是逻辑职责，不承诺对外稳定的 SQL API。

| 表 | 内容 |
| --- | --- |
| `sessions` | 会话 ID、当前项目状态、保存修订、外部目的文件、历史游标 |
| `settings` | 活动会话指针及助手配置等 |
| `resources` | SHA-256 索引的不可变 JSON 内容 |
| `commands` | 每条可撤销命令的序号、类型、前后状态 |
| `events` | 递增修订及操作类型 |
| `recovery` | 带校验和的恢复点，保留最新 10 个 |
| `requests` | 会话内请求 ID、请求指纹、提交后状态 |
| `jobs` | 缝份/偏移任务的归属、请求去重和候选记录，由 `JobManager` 建表 |

`storeState/readState` 在 SQL 内部把资源替换为 `sqlite-resource:<sha256>`。surface、快照资源、图片以及达到 64 KiB 的指定几何字段会复用资源记录，读取时核对内容哈希，再还原为普通项目对象。这个引用只属于工作库格式，不应泄漏进公开 `Project` 或外部工程数据。

命令、撤销重做、恢复都增加当前修订；游标与修订不能互换。重新编辑会删除游标之后的重做分支。请求去重按会话生效，同请求 ID 不得换内容；并非每个读写方法都记录请求重放，具体由后台入口决定。

删除会话时，所有剩余会话、命令前后状态、恢复点、请求状态和任务都是资源回收根；任何保留记录无法可靠读取都拒绝回收。删除和磁盘整理分开报告，不删除外部 `.fpcad`。损坏活动会话启动时只解除活动指针，保留原始记录供恢复。

## 工程包与交换格式

[archive.ts](../../apps/desktop/main/archive.ts) 的 `pack/unpack/readProject/atomicWrite` 管理 `.fpcad`。ZIP 内含：

- `manifest.json`：格式、结构版本、应用版本、项目 ID、时间、各文件大小与 SHA-256，以及文件清单的内容哈希。
- `project.json`：项目元数据及尚未拆分的模型库、裁切库、来源库等字段。
- `patterns.json`：当前二维纸样；`body.json`、`uv.json`、`markings.json`、`materials.json`、`seams.json`、`nesting.json`：对应领域数据。
- `character.json`、`simulation.json`：当前为空模块封套；文件名不代表已有角色系统或布料模拟。
- `images/`：具有资源结构的 reference 使用原始/来源/代理/缩略图资产引用，读取后还原 data URL；并非所有历史内嵌图像都必然拆成文件。
- 可选 `geometry.json`：清单以 `geometryEncoding: shared-json-1` 标记，64 KiB 以上的声明几何字段按精确内容哈希共享存储。当前状态、模型库、候选及裁切历史保留独立引用，读取后还原完整领域值；不舍弃历史、变更坐标或重新批准花纹。旧无共享表工程仍可读取，带此标记的新工程要求支持该编码的客户端。

当前工程包压缩及展开后的总资源受 200 MiB 限制，最多 32 个条目，并检查目录结构、路径、重复名称、清单、长度、展开比例和哈希。共享几何按实际存储内容计量，解引用后的完整项目 JSON 可能更大。该容器限制与 Zod 的实体数量限制、桌面请求的 64 MiB 限制各自生效；不能把其中一个写成应用统一容量。

保存先构建工程包并回读校验，再写同目录唯一临时文件、同步、重命名替换；失败清理临时文件，成功后更新 `savedRevision`。本地提交与恢复点不会自动覆写外部工程。

[workflow-exchange.ts](../../apps/desktop/main/workflow-exchange.ts) 的 `workflowBytes/readWorkflow` 交换完整项目 JSON；小项目保留版本 1，大块几何使用版本 2 的 `shared-json-1`，读写均保留 200 MiB 上限。版本 2 还原共享字段后继续按完整项目版本 2 契约验证，没有沿用 `parseProject` 的旧工程升级入口。`cutBundle/readCutBundle` 交换内嵌 `project.fpcad`、`catalog.json` 及可选逐片 SVG，导入核对清单和内容哈希。制造门禁不满足时，包仍可保留可编辑草稿，但不带逐片制造预览。

带 SVG 预览的裁片包共享一份 `assets/FurryPatternSansSC-Regular.ttf`，逐片 SVG 使用相对路径引用；旧无字体资源裁片包继续支持。最多 500 个 SVG、503 个总条目，整体内容仍受 200 MiB 限制。

## 契约变更时的核对范围

[generate-contracts.ts](../../scripts/generate-contracts.ts) 从 Zod 生成 JSON Schema，并生成 Rust 的二维基础结构 [schema_generated.rs](../../crates/geometry-core/src/schema_generated.rs)。它没有为所有项目实体生成 Rust 类型。生成脚本是 `node scripts/generate-contracts.mjs`，当前构建不会自动替代契约同步检查。

变更字段前需确认：

1. 旧项目省略字段时的含义，以及 v1/v2、旧历史和旧裁切快照的读取。
2. 活动状态、模型记录、候选、归档和 SQL 资源去重能否往返。
3. 依赖指纹是否变化，是否只更新原本有效的依赖，是否保留未审阅状态。
4. 失败或取消后是否保留原项目，接受是否一次提交，撤销和重做是否恢复所需资源。
5. 输出是否沿用毫米、材料和审阅约束，不能仅以模式解析成功验收。

相关测试入口见[开发与验证](../guides/development-and-validation.md)。本次未运行这些测试，测试文件存在不表示当前工作区已经通过。

# FurryPattern CAD 文档

本套文档说明电子兽装打版的制作目标、当前软件功能、工程实现和后续需求。整理日期：**2026-10-26**；应用版本 **0.8.0**；源码基准为 `0bd71c8c4d460fe44663ebee5cc484218d8b0e38`。本轮开始时源码无未提交修改；本轮只读代码，按电子打版需要修订文档，没有运行功能或实物制作验收。核对范围见[本轮修改说明](../update/2026-10-26-pattern-production-docs.md)。

安装与快速启动见[项目 README](../README.md)，协作要求见 [AGENTS.md](../AGENTS.md)。当前实现依据实际源码；文档中“已有实现”“部分支持”“待规划”分别表示代码证据和适用边界，不表示本轮测试已经通过。

## 从哪里开始

- 理解产品：先读[版片与制作概念](guides/concepts-and-workflow.md)，再看[全部参考图片](design/reference-image-analysis.md)和[需求规格](planning/requirements.md)。
- 使用软件：读[操作流程](guides/user-workflow.md)，遇到能力边界查[功能清单](guides/feature-catalog.md)。
- 准备制作：按[版片交付规格](guides/pattern-delivery.md)核对数量、左右、方向、接缝、省道和开口说明，再输出及试样。
- 开发维护：读[架构](design/architecture.md)、[数据契约](design/data-contracts.md)和[项目结构](guides/project-structure.md)，算法细节按下表查阅。
- 安排验收：从[需求与验收矩阵](planning/acceptance-matrix.md)选场景，按[开发与验证](guides/development-and-validation.md)准备真实构建和证据。

## 使用与开发指南 · guides

| 文档 | 内容 |
| --- | --- |
| [版片、兽装与电子打版](guides/concepts-and-workflow.md) | 版片、缝线、缝份、省道、毛向，以及人体／填充／外覆毛皮的区别 |
| [从设定图到制作纸样](guides/user-workflow.md) | 八阶段操作、候选确认、失败处理、历史恢复、打印和助手边界 |
| [版片交付规格](guides/pattern-delivery.md) | 每片和整组的工艺信息，当前输出内容，数量／镜像规则及需要人工补充的说明 |
| [功能清单与实现边界](guides/feature-catalog.md) | F01–F31：入口、输入输出、异常、实现状态和源码位置 |
| [项目结构](guides/project-structure.md) | 桌面、领域包、Rust 工作进程、测试、脚本和本地数据目录 |
| [开发、验证与验收证据](guides/development-and-validation.md) | 工具链、真实命令范围、隐藏桌面、构建身份、验证分层和清理边界 |

## 现行工程设计 · design

| 文档 | 内容 |
| --- | --- |
| [桌面应用架构](design/architecture.md) | Vue／Pinia、Tauri 宿主、Node 后台、SQLite、线程与 Rust worker 的实际运行链 |
| [项目数据与契约](design/data-contracts.md) | 项目实体、修订、事务、来源指纹、资源、撤销恢复和文件交换 |
| [算法处理链](design/algorithm-pipeline.md) | 从像素恢复到表面映射、材料裁切、展开、制造和输出的算法与限制 |
| [原图轮廓恢复](design/reference-contour-recovery.md) | 像素证据、共享边界、曲线恢复、孔洞、容差和失败回退 |
| [材料边界裁切](design/design-boundary-cutting.md) | 材料域、结构缝、三角化、绑定来源、补缝和候选接受 |
| [ARAP 平衡重试](design/arap-balanced-retry.md) | 展开方法、指标、局部加权、接缝求解、缓存和接受条件 |
| [外部项目与制作资料研究](design/reference-study.md) | clo3d-patterns、Blender、Seamly2D、服装纸样与兽装制作资料；已读范围和访问限制 |
| [全部参考图片解读](design/reference-image-analysis.md) | R01–R19 逐图可见内容、可推导需求和不能据图证明的结论 |

## 需求与后续规划 · planning

需求规格包含当前及后续目标，当前实现状态以功能清单和源码为证据。规划中的方案保留研究价值，不作为已交付能力宣传。

| 文档 | 内容 |
| --- | --- |
| [电子兽装打版需求规格](planning/requirements.md) | 使用角色、范围、31 项功能需求、8 项制作交付需求、9 项跨功能约束及数值门槛 |
| [需求、功能与验收矩阵](planning/acceptance-matrix.md) | 26 组功能验收、8 组制作交付核对、状态组合、6 类样本、输出回读和实物验证 |
| [后续范围与实施条件](planning/roadmap.md) | 核心制作验收优先，AI／模拟／服务等方向的启动条件 |
| [本地 AI](planning/local-ai.md) | 当前配置与本机桥边界，待实现的识别／推理及评估条件 |
| [授权能力](planning/licensing.md) | 尚未实施的账号、授权与配额方案 |
| [可选云服务](planning/cloud-services.md) | 尚未实施的目录／同步等服务及离线边界 |
| [第三方插件与 SDK](planning/plugin-sdk.md) | 注册器现状、未接通的宿主生命周期和未来接口条件 |

## 参考素材和维护规则

[别人做的效果参考](别人做的效果参考/)共有 19 张 PNG，原图保持原位。图片提供制作意图，不作为当前应用运行证据；文件名含“ChatGPT 图像”的 5 张也只作效果与操作参考。外部开源项目仅学习已查阅的结构与算法，没有向本项目复制源码或引入新依赖。

更新现行功能时同步修改需求、功能清单、相关设计和验收映射。未实现但仍有价值的方向保留在 `planning/`；旧实施过程和历史验收从 Git 追溯。新日志、截图和检测结果写入 `test-results/`，每轮修改说明写入 [update](../update/)。

整理后运行 `npm run docs:check`。它检查本地链接是否存在，不验证源码事实、功能正确性或实物制作效果。应用源码、用户项目库、工具链、固定测试样本及原参考图片不属于本轮文档整理的修改范围。

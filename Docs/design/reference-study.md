# 开源软件与制作资料研究

研究日期：2026-10-26。研究范围是与本项目相关的制版流程、展开、缝份、排料和交互，依据公开仓库、关键源码、作者教程及本地 19 张参考图。没有安装或实操这三个外部项目，没有逐行审计 Blender、Seamly2D 全仓，也没有测量外部软件的运行性能。外部 `main`／`develop` 链接可能继续变化，本次未取得完整上游提交快照。

## 三个项目的分工

| 项目 | 实际性质 | 本次核对内容 | 用于本项目的判断 |
| --- | --- | --- | --- |
| [tabjy/clo3d-patterns](https://github.com/tabjy/clo3d-patterns) | 作者用 CLO 制作的服装纸样作品集 | README、目录与资源性质；含 catsuit、gloves、hood 等 | 可学习成套纸样的组织，不应称为 CLO 求解器源码，也不能据此承诺读取 CLO 工程 |
| [Blender](https://github.com/blender/blender) | 通用三维制作软件，仓库为官方镜像 | UV 操作、分缝、参数化、pin、展开及排岛相关源码 | 学习模型编辑与展开分层；需要额外补齐服装制造语义 |
| [Seamly2D](https://github.com/FashionFreedom/Seamly2D) | 参数化二维服装制版软件 | 版片主路径、缝份、剪口和布局代码，官方社区操作说明 | 学习从草图到版片再到布局的分离，保留尺寸与工艺元数据 |

`clo3d-patterns` 仓库声明的是 CC BY-SA 4.0 作品许可；本次所读 Blender 源码标记 GPL-2.0-or-later，Seamly2D 源码标记 GPL-3.0-or-later。本轮只写研究和项目文档，没有复制这些软件的实现或资源到应用。资源及代码若以后要引入，应逐项记录来源与许可，不把“公开可查看”当成无条件可再分发。

## Blender 的操作与算法

可复现的操作路线是：检查物体尺寸和变换，进入网格编辑，选择需要展开的面，标出 seam，执行 UV Unwrap，在 UV 编辑器中检查岛、固定点和失真，再调整缝或 pin 重算。官方手册列出 Angle Based（ABF）、Conformal（LSCM）和 Minimum Stretch（SLIM）。此处描述的是外部工作方式，不是本项目已有三个对应按钮。[Blender UV 操作](https://docs.blender.org/manual/id/4.5/modeling/meshes/editing/uv.html)

| 关键源码 | 阅读结果 | 对当前工程的启发 |
| --- | --- | --- |
| [uv_parametrizer.cc](https://raw.githubusercontent.com/blender/blender/main/source/blender/geometry/intern/uv_parametrizer.cc) | `PVert`／`PEdge`／`PFace` 表达局部图；`p_chart_lscm_begin` 处理 pin 和线性求解初始化；SLIM 转换层传递面、边、边长与约束 | 图拓扑、初始化、求解和结果回写应分层；钉住 UV 位置并不自动约束每条缝的物理长度 |
| [uvedit_unwrap_ops.cc](https://raw.githubusercontent.com/blender/blender/main/source/blender/editors/uvedit/uvedit_unwrap_ops.cc) | `unwrap_exec` 连接选择状态、展开选项与结果；操作注册为可撤销命令 | 交互命令与几何核心分离，失败、撤销和用户选区均属于操作契约 |
| [uv_pack.cc](https://raw.githubusercontent.com/blender/blender/main/source/blender/geometry/intern/uv_pack.cc) | UV 岛布局有独立实现 | 纹理岛排版和按布幅、材料、毛向约束的排料应分别设计 |

算法目标的区别：LSCM 以局部保角为目标；ARAP 让局部变换接近刚性；ABF 优化三角角度；SLIM 面向局部不翻转的低失真映射。这些目标并不直接包含缝份、左右片配对、毛向、裁剪数量和真实材料伸缩。本项目现有核心是 LSCM 初始化、ARAP 及接缝长度约束，不应写成已经移植 Blender 的 ABF 或 SLIM。当前实现详见[算法总览](algorithm-pipeline.md)。

## Seamly2D 的版片操作

官方社区的操作说明先在 Draft 中构造点和曲线，再创建 Pattern Piece，在 Piece 模式编辑属性，随后建立 Layout 并导出。分阶段组织可避免把构造辅助线、生产版片和输出纸张混成一种对象。本次没有复测具体版本的快捷键，故不把历史论坛界面当成当前逐键教程。[Preparing pattern for print](https://forum.seamly.io/t/preparing-pattern-for-print/9118)、[How to edit the pieces](https://forum.seamly.io/t/how-to-edit-the-pieces-in-seamly/8676)

| 关键源码 | 阅读结果 | 对当前工程的启发 |
| --- | --- | --- |
| [vpiece.cpp](https://raw.githubusercontent.com/FashionFreedom/Seamly2D/develop/src/libs/vpatterndb/vpiece.cpp) | `seamAllowancePoints` 组合节点／曲线与自定义缝份；`cutPathPoints` 按有无独立缝份选择裁剪路径；`createNotchLines` 单独生成剪口 | 主轮廓、裁剪轮廓与剪口要分别保存和检查，不能把一条显示线当成全部生产信息 |
| [vabstractpiece.cpp](https://raw.githubusercontent.com/FashionFreedom/Seamly2D/develop/src/libs/vlayout/vabstractpiece.cpp) | `Equidistant` 对闭合路径逐点构造偏移，处理拐角并检查结果 | 缝份不是把版片中心放大；凹角、窄缝和孔洞需单独处理 |
| [vlayoutgenerator.cpp](https://raw.githubusercontent.com/FashionFreedom/Seamly2D/develop/src/libs/vlayout/vlayoutgenerator.cpp) | `Generate` 准备待排片、纸张状态和循环，可停止布局生成 | 排料是有预算、可取消、可失败的独立任务，不应阻塞编辑会话 |
| [vlayoutpaper.cpp](https://raw.githubusercontent.com/FashionFreedom/Seamly2D/develop/src/libs/vlayout/vlayoutpaper.cpp) | `arrangePiece` 与 `addToSheet` 搜索放置位置，受旋转／翻转规则控制，选择有效结果后保存 | 布片方向限制和有效放置先于利用率；本项目仍需按毛皮材料核验方向 |

项目自己的 `Piece`、材料、接缝与排料已有实现，但尚不是 Seamly2D 的测量公式制图系统。不能把模型围度输入称为完整的二维参数化原型制图、推板放码或省转移工具。

## 制作资料和联网图片

| 来源 | 本次使用的证据 | 限制 |
| --- | --- | --- |
| [山本教育纸样下载](https://www.shanbenjiaoyu.com/forum.php?mod=forumdisplay&fid=22&forumdefstyle=yes) | 服装纸样文件类别及公开帖子页面 | 未取得受限附件，未验证 PRJ、ET 或行业 DXF 兼容性 |
| [WikiFur 兽装制作](https://zh.wikifur.com/w/index.php?title=%E7%8D%B8%E8%A3%9D%E8%A3%BD%E4%BD%9C&variant=zh-hans) | 头、身体、尾、手脚与材料／填充的工艺分工 | 社群概述不是本项目质量标准 |
| [Buckaroo Fursuits 制作图文](https://www.buckaroofursuits.com/the-process.html) | 搜图找到的胶带取样、分片和毛皮缝合示例 | 图片只解释工作过程，不提供可直接复用的精确纸样 |
| [Matrices 教程入口](https://www.matrices.net/tutorials.htm)与[胶带取样](https://pupdates.matrices.net/post/52071465448/tutorial-patterning-objects-with-tape-a-very) | 作者公开的取样、试样和制作流程 | 本次读取公开说明，没有购买教程或把视频完整观看写成已完成 |
| [本地图片逐张分析](reference-image-analysis.md) | 19 张原图的可见内容、需求推导和实现差距 | 不将概念图、宣传图、文件名或小字猜测当成运行证据 |

联网图片检索使用了 `Matrices fursuit pattern duct tape fur direction`，据结果回到作者的制作页面核对。没有将搜索摘要中未经作者正文核对的缝份数值写入默认参数。个别 Blender 手册页、Seamly Wiki 和 PDF 返回访问错误；相关结论改用可读取的官方手册索引、官方源码及维护者说明交叉核对，未把失败页面列作已精读资料。

## 三种工作方式怎样转成项目要求

| 研究对象 | 操作／结果的组织方式 | 对本项目的具体取舍 |
| --- | --- | --- |
| clo3d-patterns | 已完成纸样按服装项目组织 | 学习一套纸样的部件组织与用途；它不提供可直接移植的三维求解器 |
| Blender UV | 选面、设 seam／pin、展开、检查并调整岛 | 保留人工裁线和可复核映射；UV 岛还需恢复毫米尺度、制作信息及装配关系，不能直接当最终纸样 |
| Seamly2D 版片 | 构造路径、生成版片、编辑工艺属性、布局／分页输出 | 主轮廓、内部线、缝份和标记应分别表达；本项目缺少的工艺对象应列为需求，不把自由文字等同于专用编辑器 |
| 兽装胶带／试样打版 | 先确定要包覆的形状，再标色块、缝线和方向，拆片后试制 | 对应人体／填充／外覆表面选择、材料分区、结构缝和试样回修；手工选择仍需保留 |

Seamly 维护者对打印问题的说明特别区分主轮廓与内部路径：把内部线混进主路径会破坏片形。结合本项目现有 `Piece`、`Seam` 与导出实现，新增的[版片交付规格](../guides/pattern-delivery.md)要求明确线条用途、实例数量、方向和未自动输出的工艺说明。[操作来源](https://forum.seamly.io/t/preparing-pattern-for-print/9118)

本轮再次检索 `fursuit tape pattern seam allowance fur direction Matrices` 图片，并回读可访问的作者正文；图片中的毛向箭头和片名用于理解工艺，没有下载第三方纸样或复制其设计。搜索找到但正文无法访问的尾巴教程、返回访问错误的 Blender 手册页，不作为新增算法结论的依据。

## 对需求的取舍

本项目应优先保证毫米尺寸、源图忠实度、材料语义、三维二维对应、服装结构缝、可撤销修版和实际尺寸输出。外部软件展示的渲染、布料动态、自动重建、商业图库等能力，不自动进入本项目现有功能清单。

研究提出的下一步是完善可缝制结构缝与实物试样验收。它不授权本轮修改算法或改变代码；本轮只更新文档。需求与优先级见[需求文档](../planning/requirements.md)。

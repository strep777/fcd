# 电子兽装打版文档体系重整

日期：2026-10-26。应用版本仍为 0.8.0，HEAD 为 `498d61db374bbc7c7c1b66e32141f7e8e534045b`。本轮任务是项目代码只读、整理文档；没有修改算法、界面、契约、配置、测试或依赖，没有构建、启动应用、清理数据、提交或推送代码。

## 交付内容

重整 `Docs/design/`、`Docs/guides/`、`Docs/planning/`，更新 [Docs 入口](../Docs/README.md)。三个目录共 20 篇文档，加入口共 21 篇；旧文件名保留以维持已有链接，内容按当前实现重写，不再混用历史验收与现行规格。

- 工程文档：实际 Tauri → Node → Rust 工作进程运行链、SQLite 事务／修订／恢复、资源与契约、算法链、源码位置、构建和验证范围。
- 功能文档：F01–F31 的入口、输入输出、失败／取消、当前状态和源码证据，以及八阶段操作流程。
- 需求文档：31 项功能需求、9 项跨功能约束、26 组功能验收、6 类制作样本；对应当前、部分支持及后续目标。
- 参考研究：三个上游项目、服装纸样资料、兽装制作图文与图片检索，以及用户目录全部 19 张 PNG 的逐图解读。
- 后续规划：保留本地 AI、授权、云服务和第三方插件的有效方向，明确尚未落地和待验证条件。

明确区分纸样、花纹区域、三角网格与 UV；区分穿戴者身体、填充衣身和角色外形；区分缝制材料与印绘细节、几何重建与布料模拟、计算检查与实物试缝。

## 研究和复核范围

外部研究读取公开页面、关键源码与作者教程，来源和访问限制记录在[研究文档](../Docs/design/reference-study.md)。`clo3d-patterns` 是 CLO 制作的纸样作品集，不是 CLO 算法开源仓库。未宣称逐行审计 Blender／Seamly2D 全仓，未安装实操外部软件，也没有复制上游源码或素材到应用。

19 张图片均逐张查看，原文件未改。参考图中的外形、裁线和版片作为需求依据，不能替代真实源模型、尺寸、接缝误差或运行证据。

工程与功能两个独立只读复核检查了当前实现、接口和需求映射。已按源码修正三处表述：本机桥关闭不保证中止已开始操作；来源删除只因锁定等具体条件受阻，未锁定来源可连同关联贴附删除；模块当前使用无参数 `initialize()`。主审另核对了失真硬阈值应按每面最大值检查，而非平均值。

## 实际验证

- `npm run docs:check`：本地 Markdown 链接检查通过，最终统计见 `test-results/docs-validation.json`。
- `git diff --check -- Docs update`：差异格式检查通过；Git 的 LF／CRLF 提示不影响该检查结果。
- 文档结构检查：21 篇文档无未闭合代码块、替换乱码或行尾空白；F、FR、NFR、AT 和 R 编号无重复，FR／NFR 验收映射完整；19 张图片全部列入索引。
- 没有运行类型检查、Rust／Vitest、桌面、打印或实物试缝验收。测试文件仅列作入口，没有复用旧报告宣称本轮功能通过。

## 只读边界与并行工作区变化

开始时为 Docs／update 之外的 1,103 个受 Git 跟踪或未忽略文件建立 SHA-256 基线。截至 2026-10-26 22:18（北京时间），检测到以下 10 个文件与起始基线不同；这些文件不是本轮文档操作写入，未回滚或纳入提交：

```text
packages/reference/sheet-figures.ts
packages/reference/background.ts
packages/reference/illustration.ts
tests/integration/joined-chart-seed-independent.test.ts
tests/integration/reference-sheet-blue-white-figures-independent.test.ts
tests/integration/reference-sheet-figures-independent.test.ts
tests/reference-sheet-manufacturing-e2e.mjs
tests/reported-functional-acceptance-contract.md
tests/README.md
tests/real-dual-view-e2e.mjs
```

因此不能声称整段工作期间源码快照保持不变，也不能只凭 HEAD 重现本文。已回读相关提取逻辑，并按当日工作区解释；背景估计、整图识别窗口及多部位上下文仍属传统图像处理和规则分类。完整基线、最终指纹及核对时间保存在 `test-results/documentation-audit/`。该记录区分文档检查通过与源码快照变化，不将两者混成一个功能测试结果。

本轮实际写入范围仅为上述文档、此修改说明及 `test-results/` 中的核对记录。用户项目库、原参考图、工具链和已有工作区修改均保留。

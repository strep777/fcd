# FurryPattern CAD 开发协作指南

## 项目与工作目录

这是面向兽装花纹、三维映射和二维纸样制作的 Windows 桌面 CAD。主要技术栈为 Electron、Vue 3、TypeScript、Pinia、SQLite 和 Rust。

- 当前维护源码直接位于仓库根目录，`apps/`、`packages/` 和 `crates/` 是并列目录。根目录 `package.json` 是应用配置，直接执行开发命令。
- 根目录 `README.md` 面向使用者；本文件 `AGENTS.md` 是开发协作规则与规范索引入口，也用于自动发现项目规则。
- Git 分支与提交规范见 [BRANCH_CONVENTION.md](BRANCH_CONVENTION.md)。创建或命名工作分支时遵循类型前缀与简短英文描述；已有适用分支可继续使用。提交标题必须带类型前缀，格式为 `type: 简体中文概述`，可选作用域格式为 `type(scope): 简体中文概述`。
- 目录职责见 `Docs/guides/project-structure.md`；文档、测试与脚本索引分别位于各自目录的 `README.md`。
- 在操作前检查 `git status`，保留已有修改。按任务范围改动，不顺手改写整个历史模块。

## 模块边界

| 目录 | 职责 |
| --- | --- |
| `apps/desktop/src/` | Vue 页面、组件、编辑交互与统一会话状态 |
| `apps/desktop/main/` | Electron 主进程、IPC、数据库事务、导入导出及工作线程调度 |
| `packages/schema/` | Zod 数据契约、项目版本与迁移；修改数据结构从这里开始 |
| `packages/reference/` | 原图处理、选区、轮廓恢复与贴附配准 |
| `packages/surface/` | 曲面、绑定、裁切、三维对应关系与预览 |
| `packages/pattern/` | 二维轮廓、曲线、节点和路径编辑 |
| `packages/manufacturing/`、`packages/nesting/` | 材料依赖、打印分页、制版限制与排料支持 |
| `crates/geometry-core/`、`crates/worker/` | Rust 几何算法与独立 JSON 工作进程 |

渲染端通过 `preload.ts` 暴露的受控 API 请求主进程。写入经过修订检查和 `Repository` 事务。耗时几何任务使用独立进程或工作线程，避免阻塞界面和主进程。共享的纯函数放入对应领域模块；主进程专用逻辑保留在 `apps/desktop/main/`。

## 必须保持的业务约束

- 几何单位为毫米；屏幕缩放不得改变导出尺寸。分页输出保持 1:1，并保留 100 mm 校验尺。
- 写命令携带项目 ID 和预期修订号。已提交状态、撤销历史、恢复点和请求重放应保持事务一致；失败不能留下半完成修改。
- 候选计算与确认后的裁片分开。接受结果时检查输入版本、来源哈希和审阅状态；取消后的结果不得再写入。
- 修改轮廓、模型或花纹时维护绑定与依赖哈希。精确节点细分可更新原本匹配的依赖，但不能把已失效依赖改成有效，也不能自动批准未审阅推断。
- `marking-fingerprint.ts` 是花纹依赖指纹的统一实现。指纹覆盖字段或序列化方式变动时检查历史项目兼容性。
- 材料删除必须检查当前裁片、花纹库、非活动模型、裁切历史和计算候选中的引用。
- 裁切库是历史快照。编辑当前状态时保留历史快照，恢复历史版本时保留所需资源与依赖。
- 保持 Electron 的沙箱、上下文隔离、IPC 来源检查及本机助手权限约束；文件导入继续执行大小、路径、契约和完整性校验。

## 环境与常用命令

建议 Node.js 24，项目指定 npm 11.13.0。Rust 使用根目录 `rust-toolchain.toml` 固定的 1.90.0，Windows 构建需要 MSVC C++ 工具及 Windows SDK。

在仓库根目录运行：

```powershell
npm ci
npm run build:rust
npm run typecheck
npm test
npm run test:rust
npm run build
npm start
```

`npm start` 运行已构建的 `dist`。`npm run dev` 是构建后启动，不是热更新。前端构建需要先生成 `target/release/fpcad-worker.exe`；不能用假工作进程替代真实几何验证。

按改动范围先运行相关测试，例如本次两类状态修复：

```powershell
npm test -- tests/integration/topology-provenance.test.ts tests/integration/material-history.test.ts
```

几何算法修改再运行 Rust 测试及相关集成测试；IPC、工作线程和界面流程修改需要应用构建与对应桌面测试。完整检查入口为 `npm run verify`，桌面套件为 `npm run test:desktop`。报告实际执行结果；缺少工具链、链接器、原生工作进程或资源时明确说明验证限制。

新增回归测试验证可观察的业务结果和失败后的状态完整性，覆盖有效、失效和未审阅状态。无需原生求解的持久化测试可以使用 `tests/fixtures/accepted-cut.ts`；算法正确性仍使用真实 Rust 工作进程。哈希测试先通过契约规范化输入，再计算持久化指纹。

## 数据、产物与文档

- 根目录 `.local/workspace/` 是用户项目库；禁止作为测试缓存清理。
- `.tools/` 是本地工具链与依赖，不作为旧程序残留删除。
- `node_modules/`、`target/`、`target-*/`、`dist/`、`release/`、`.local/tests/`、`test-results/` 是本地依赖或生成内容，不能加入源码提交。
- 清理脚本先运行 `-WhatIf`，检查实际目标和链接，并确认相关测试进程已关闭。保留用户库、固定测试样本、生产资源、发布包及已有验收记录。
- `Docs/` 的现行指南与设计放入 `guides/`、`design/`，尚未落地但仍有价值的规划放入 `planning/` 并注明当前状态、待实现内容和未验证目标。保留未落地规划；删除已被现行文档替代的重复说明和过时实施记录，历史验收资料通过 Git 追溯。
- 新生成的验证日志、截图和报告放入 `test-results/`，不直接写入文档目录。整理后运行 `npm run docs:check` 校验链接。
- 导出给用户的能力、命令或目录发生变化时同步更新 README 与目录索引。
- 如任务要求提交代码，遵循 [.github/git-commit-instructions.md](.github/git-commit-instructions.md)：标题类型前缀不可省略，冒号后有一个空格，概述使用简体中文；缺陷修复使用 `fix:` 或 `fix(scope):`。未要求提交时交付工作区修改及验证结果。

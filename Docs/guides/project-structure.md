# 项目结构与代码定位

基准日期：2026-10-26。应用版本：0.8.0；基准提交 `0bd71c8c4d460fe44663ebee5cc484218d8b0e38`。本页按当前工作区整理；目录和实现的存在不表示本次已运行验收。

当前应用源码直接放在仓库根目录下的 `apps/`、`packages/`、`crates/`，根 `package.json` 是实际应用配置，没有另一个需要进入的旧版子项目。使用入口见[项目 README](../../README.md)，开发命令与验证边界见[开发与验证](development-and-validation.md)。

## 目录职责

```text
fcd/
├── AGENTS.md                     开发协作规则
├── README.md                     使用与安装入口
├── package.json / package-lock.json
├── apps/desktop/
│   ├── src/                      Vue 页面、编辑器、交互及会话
│   ├── main/                     Node 后台、持久化、文件、任务调度
│   ├── src-tauri/                Rust 原生宿主、窗口、权限及打包
│   ├── index.html
│   └── print.html
├── packages/                     共享领域逻辑和契约
├── crates/
│   ├── geometry-core/            Rust 几何实现与测试
│   └── worker/                   独立 JSON 工作进程
├── assets/                       字体、生产资源及许可声明
├── scripts/                      构建、运行、测试及维护入口
├── tests/                        单元、集成、组件、桌面及固定样本
├── Docs/
│   ├── guides/                   使用、工程入口与验证指南
│   ├── design/                   当前实现和设计边界
│   ├── planning/                 未落地需求及方案
│   └── 别人做的效果参考/          用户提供的制作效果参考
├── update/                       每次修改说明
├── Cargo.toml / Cargo.lock       几何与worker工作区
├── rust-toolchain.toml
├── tsconfig.json / vite.config.ts / vitest.config.ts
└── 启动新版FurryCAD.bat            根目录构建并启动入口
```

| 共享包 | 职责 |
| --- | --- |
| [schema/](../../packages/schema/) | Zod 项目、请求、命令、助手配置，派生 TypeScript 类型和生成契约 |
| [api/](../../packages/api/) | `desktopClient`、文本回复解析与单回复图片复用 |
| [reference/](../../packages/reference/) | 原图资源、设定图/视图、选区、轮廓、部位识别及配准元数据 |
| [body/](../../packages/body/) | 人体/模型参数默认值与参数验证 |
| [surface/](../../packages/surface/) | 曲面对应、贴附、裁切与展开领域逻辑、三维预览数据 |
| [pattern/](../../packages/pattern/) | 二维路径、曲线、节点、孔和编辑操作 |
| [manufacturing/](../../packages/manufacturing/) | 材料、接缝、输出预算、实际尺寸分页 |
| [nesting/](../../packages/nesting/) | 排料轮廓支持；后台搜索与运行时仍在 `main/` |
| [workflow/](../../packages/workflow/) | 根据项目状态生成制作节点 |
| [ui/](../../packages/ui/) | 页面共用的视口、纸样预览和局部草稿历史 |
| [modules/](../../packages/modules/) | `ModuleRegistry` 基础类；生产启动尚未调用 |

目录名不代表运行进程。例如 `packages/surface/` 的函数可由后台或工作线程调用；`main/surface-worker.ts` 才是线程入口。Rust 几何计算不应挪进 Vue 组件，渲染端也不能直接使用 SQLite。

## 从需求找到入口

| 需求 | 源码与符号 |
| --- | --- |
| 统一会话、操作锁与页面错误 | [store.ts](../../apps/desktop/src/store.ts) 的 `useSession/run/refresh` |
| 桌面 API 与传输 | [tauri-transport.ts](../../apps/desktop/src/tauri-transport.ts) 的 `send`；[bridge-client.ts](../../apps/desktop/src/bridge-client.ts)；[api/client.ts](../../packages/api/client.ts) 的 `desktopClient` |
| Tauri 窗口、原生对话框与私有管道 | [src-tauri/src/main.rs](../../apps/desktop/src-tauri/src/main.rs) 的 `Backend/desktop_request/native`；[host-channel.ts](../../apps/desktop/main/host-channel.ts) 的 `serve/nativeCall` |
| 请求队列、修订检查与服务编排 | [main.ts](../../apps/desktop/main/main.ts) 的 `dispatch/handle/startup` |
| 事务、历史、恢复和资源回收 | [repository.ts](../../apps/desktop/main/repository.ts) 的 `Repository.commit/historyMove/restore/deleteSession` |
| 外部工程与交换 | [archive.ts](../../apps/desktop/main/archive.ts) 的 `pack/unpack/atomicWrite`；[workflow-exchange.ts](../../apps/desktop/main/workflow-exchange.ts) 的 `workflowBytes/cutBundle` |
| 契约、版本与生成器 | [schema/index.ts](../../packages/schema/index.ts) 的 `projectSchema/parseProject/requestSchema`；[generate-contracts.ts](../../scripts/generate-contracts.ts) |
| 原图导入和提取 | [references.ts](../../apps/desktop/main/references.ts)；[automatic-reference.ts](../../apps/desktop/main/automatic-reference.ts)；[library-region-edit.ts](../../apps/desktop/main/library-region-edit.ts) |
| 自动与手工贴附 | [automatic-placement.ts](../../apps/desktop/main/automatic-placement.ts)；[markings.ts](../../apps/desktop/main/markings.ts)；[surface-marking-edit.ts](../../apps/desktop/main/surface-marking-edit.ts) |
| 来源失效与花纹依赖 | [marking-fingerprint.ts](../../apps/desktop/main/marking-fingerprint.ts) 的 `markingFingerprint`；`markings.ts` 的 `staleMarkingIds/markingIssues` |
| 模型状态和裁切快照 | [project-lifecycle.ts](../../apps/desktop/main/project-lifecycle.ts) 的 `saveActiveModel/assertModelDetach`；[cutting-library.ts](../../apps/desktop/main/cutting-library.ts) 的 `archiveCut/activateCut` |
| 表面线程、取消和进度 | [surface-runtime.ts](../../apps/desktop/main/surface-runtime.ts) 的 `runTask`；[surface-worker.ts](../../apps/desktop/main/surface-worker.ts)；[surface-task-queue.ts](../../apps/desktop/main/surface-task-queue.ts) |
| 原生进程协议与退出确认 | [worker.ts](../../apps/desktop/main/worker.ts) 的 `request/createWorkerSession/analyze`；[native-process.ts](../../apps/desktop/main/native-process.ts) |
| 缝份/偏移候选 | [jobs.ts](../../apps/desktop/main/jobs.ts) 的 `JobManager` |
| 排料与组装线程 | [nesting-runtime.ts](../../apps/desktop/main/nesting-runtime.ts) 的 `runNesting`；[assembly-runtime.ts](../../apps/desktop/main/assembly-runtime.ts) 的 `runAssembly` |
| 材料、依赖与制造输出 | [manufacturing/dependencies.ts](../../packages/manufacturing/dependencies.ts) 的 `materialInUse`；[export.ts](../../apps/desktop/main/export.ts) 的 `gate/svgExport/pdfExport/dxfExport` |
| 本机助手及配置 | [assistant-bridge.ts](../../apps/desktop/main/assistant-bridge.ts) 的 `AssistantBridge`；[assistant-settings.ts](../../apps/desktop/main/assistant-settings.ts) 的 `AssistantSettings` |
| 页面草稿撤销 | [useDraftHistory.ts](../../apps/desktop/src/modules/useDraftHistory.ts)；[ui/draft-history.ts](../../packages/ui/draft-history.ts) 的 `DraftHistory` |

具体业务按[功能目录](feature-catalog.md)定位；曲面算法见设计文档。前端大量组件直接位于 `src/`，当前没有统一 `pages/components/stores` 子目录体系，文档不应虚构分层。

## 三套构建范围

根 [Cargo.toml](../../Cargo.toml) 只包含 `crates/geometry-core` 与 `crates/worker`。Tauri 宿主有独立的 [src-tauri/Cargo.toml](../../apps/desktop/src-tauri/Cargo.toml)、Cargo.lock 和工作区。根 `npm run test:rust` 不自动运行宿主中的精度与帧协议测试。

[Vite 配置](../../vite.config.ts) 以 `apps/desktop` 为根，输出到 `dist/renderer`；后台和线程由 [build.mjs](../../scripts/build.mjs) 的 esbuild 步骤输出到 `dist/main`。`build:frontend` 名称包含“frontend”，实际还准备 Node 运行时、后台、原生 worker、Canvas 依赖、WASM、字体与许可文件。

| 产物 | 生成入口 |
| --- | --- |
| `target/release/fpcad-worker.exe` | `npm run build:rust` |
| `dist/renderer`、`dist/main`、`dist/bin` 等 | `npm run build:frontend` |
| `apps/desktop/src-tauri/target/release/FurryPatternCAD.exe` | `npm run build` 的 Tauri 构建 |
| 调试宿主 | `npm run build:desktop:test` |
| `release/FurryPatternCAD-<version>-win-x64-<hash>/` | `npm run package`；`release/latest.json` 指向最新包 |
| `apps/desktop/src-tauri/target/release/bundle/nsis/` | `npm run package:installer` |

## 工作库、生成文件和保留边界

| 路径 | 用途及处理规则 |
| --- | --- |
| `.local/workspace/` | 仓库启动器缺省用户工作库，禁止当测试缓存清理 |
| `%APPDATA%/FurryPatternCAD/` | 直接 EXE / 安装版缺省用户工作库；确认启动方式后再定位数据 |
| `.tools/`、`node_modules/` | 工具链、本地依赖和离线资源，不是旧程序残留 |
| `target/`、`target-*/`、Tauri `target/` | 各自编译生成内容，不加入源码提交 |
| `dist/`、`release/` | 构建与分发产物；分发需整包，不能只复制 EXE |
| `.local/tests/` | 隔离测试库、临时目录、控制管道和测试构建 |
| `test-results/` | 日志、截图、导出样本、报告及源码/构建指纹；保留本次需要的证据 |
| `tests/fixtures/`、`assets/` | 固定回归样本及生产资源，属于源码并保留来源/许可证 |
| `Docs/guides/`、`Docs/design/` | 当前指南与实现说明；本次核对不等于功能通过 |
| `Docs/planning/` | 需求、未来方案和未验证目标；不得写成已发布能力 |
| `update/` | 修改说明，写清范围、实际验证和未完成项 |

`FPCAD_DATA_DIR` 可以覆盖工作库位置。测试应显式隔离数据，不从目录名称推断里面没有用户项目。

[clear-test-data.ps1](../../scripts/clear-test-data.ps1) 会覆盖多个测试与报告目录，先用 `-WhatIf` 审查；其 `-IncludeLegacyProfile` 甚至可包含 APPDATA 用户库，不能作为日常自动清理选项。[generated-output.mjs](../../scripts/generated-output.mjs) 的 `removeGenerated/assertOutputUnlocked` 限定构建清理范围并检查运行中的 EXE、DLL 和原生模块；构建占用时保留已有产物。

测试分层和产物证据见[开发与验证](development-and-validation.md)，详细脚本清单见[脚本导航](../../scripts/README.md)，固定测试入口见[测试目录](../../tests/README.md)。本次没有启动应用、清理数据或重跑功能测试。

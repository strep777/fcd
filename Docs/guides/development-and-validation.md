# 开发、验证与验收证据

基准日期：2026-10-26。应用版本：0.8.0；基准提交 `0bd71c8c4d460fe44663ebee5cc484218d8b0e38`。本次按当前工作区核对命令、测试与实现，没有安装依赖、构建、启动应用或运行功能测试。本文中的命令是可执行入口说明，不能作为已通过记录。

开发协作规则见 [AGENTS.md](../../AGENTS.md)，代码定位见[项目结构](project-structure.md)，当前行为边界见[功能目录](feature-catalog.md)。只改文档的任务应检查事实与链接，并报告未执行功能验证。

## 环境和开始前的检查

在仓库根目录运行命令。当前用户工作区为 `F:\公司\fcd`；项目建议 Node.js 24，指定 npm 11.13.0；Rust 1.90.0 由 [rust-toolchain.toml](../../rust-toolchain.toml) 固定。Windows 构建还需 MSVC C++ 构建工具、Windows SDK 和可用的 WebView2。

```cmd
cd /d F:\公司\fcd
git status --short
node --version
npm --version
```

先确认已有修改和实际任务范围。用户工程、固定回归样本、生产资源、可用工具链和需要保留的验收记录不能当成旧数据删除。`.local/workspace/` 与 `%APPDATA%/FurryPatternCAD/` 可能分别包含用户项目；实际目录由启动方式及 `FPCAD_DATA_DIR` 决定。

[scripts/cargo.mjs](../../scripts/cargo.mjs) 优先使用 `.tools/cargo`、`.tools/rustup`，存在本地 vendor 时加入离线依赖配置，否则使用系统 Cargo。[tauri.mjs](../../scripts/tauri.mjs) 也选择本地 Rust 工具链，缺省限制 3 个 Cargo 构建任务。不要仅凭系统 `cargo --version` 推断包装脚本使用的工具链。

## 命令的实际范围

以下行为以根 [package.json](../../package.json) 和脚本实现为准。

| 命令 | 实际行为与前提 |
| --- | --- |
| `npm ci` | 按锁文件安装 Node 依赖；首次准备可能需要网络 |
| `npm run build:rust` | 根 Cargo 工作区的 release 构建，带 `--locked`；生成真实原生 worker |
| `npm run build:frontend` | 重新生成 `dist`：esbuild 后台及线程、Vite 页面，并复制原生 worker、当前 Node 运行时、Canvas 原生依赖、WASM、字体与许可文件 |
| `npm run build` | 先执行上一步，再 Tauri release 构建 `--no-bundle`；不会先编译几何 worker |
| `npm start` | 运行根工作区 Tauri release EXE，缺省注入 `.local/workspace`；不构建、不自动选择便携包 |
| `npm run dev` | `build` 后 `start`；没有热更新服务，Rust 变更仍需先 `build:rust` |
| `npm run typecheck` | `vue-tsc --noEmit`；检查 tsconfig 包含的应用、共享包及 TypeScript 测试 |
| `npm test` | 运行 `tests/**/*.test.ts` 的 Vitest；部分文件会调用真实 Rust worker |
| `npm run test:rust` | 根 Cargo 工作区 `test --workspace --locked`，不包含独立 Tauri 宿主工作区 |
| `npm run check` | 依次 typecheck、Vitest、根 Rust 测试 |
| `npm run verify` | 依次执行下述 7 步，遇到失败停止；不包含桌面套件和完整发布验收 |
| `npm run build:desktop:test` | 先构建 `dist`，再构建 Tauri debug 宿主；需要已生成真实 worker |
| `npm run test:desktop` | 运行脚本内选定的默认桌面列表；不会自动准备调试构建，也不等于运行每个 `*.mjs` |
| `npm run package` | 先 build:rust、build:frontend，再生成带内容哈希的便携目录和 `release/latest.json` |
| `npm run package:installer` | 准备 worker 与 dist，再调用 Tauri 打包 NSIS 安装程序 |
| `npm run docs:check` | 检查本地 Markdown 链接，写 `test-results/docs-validation.json`；不编译软件，也不验证文档事实 |

[build.mjs](../../scripts/build.mjs) 依赖已有 `target/release/fpcad-worker.exe`，不能用占位可执行文件替代。它把构建进程使用的 Node 复制到包内，因此发布运行时取决于实际构建环境，不仅取决于文档建议版本。重建前关闭使用当前产物的应用及测试；[generated-output.mjs](../../scripts/generated-output.mjs) 的 `assertOutputUnlocked` 发现 EXE、DLL 或原生模块占用时保留旧产物并拒绝清理。

从源码完整准备并启动的顺序：

```cmd
npm ci
npm run build:rust
npm run build
npm start
```

根目录 BAT 也会准备依赖、编译原生 worker、构建并启动。启动器日志为 `test-results/startup/launcher.log`，每次启动覆盖；它不是可长期复用的冻结验收证据。

## verify 没有覆盖的部分

[verify.mjs](../../scripts/verify.mjs) 的 7 步为：TypeScript/Vue 类型检查、Vitest、根 Rust 测试、rustfmt、clippy、`scripts/build.mjs`、Tauri release 非安装包构建。输出写入 `test-results/evidence/<version>/`，其中 `verification.json` 记录实际执行步骤及退出码。

它不先执行 `build:rust`，因此运行前必须准备与目标源码相符的 release worker。Rust 测试产生的测试二进制不能代替发布 worker。它也不自动运行：

- 隐藏 WebView2 桌面套件、可选的真实用户输入复现链或组件浏览器脚本。
- 独立 Tauri Cargo 工作区的 Rust 测试。
- 便携包/安装程序的分发验收，以及真实打印机的 100 mm 实测。
- 每份独立导出审计、制作外形目视检查和实体材料试制。

Tauri 帧协议与数值往返测试位于 `apps/desktop/src-tauri/src/`，可单独调用：

```cmd
node scripts/cargo.mjs test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
```

## 测试分层与证据能力

| 层 | 入口及样例 | 能确认的范围 |
| --- | --- | --- |
| 静态检查 | `typecheck`、rustfmt、clippy | 类型、格式和对应编译诊断；不证明业务结果 |
| 纯函数与状态回归 | `npm test`；[repository.test.ts](../../tests/integration/repository.test.ts)、[repository-checkpoint.test.ts](../../tests/integration/repository-checkpoint.test.ts)、[material-history.test.ts](../../tests/integration/material-history.test.ts) | 命令、依赖、事务及失败状态；具体以断言和执行记录为准 |
| 原生算法与领域集成 | 根 Rust 测试、使用真实 worker 的 `tests/integration/` | 原生协议、几何结果及候选到项目的数据链；不能由假 worker 代替 |
| Vue 组件与浏览器夹具 | `tests/*component.mjs`、部分 `*browser.mjs` | 真实组件交互；使用绘图替身的测试不能证明 WebView2/GPU 像素 |
| 原生桌面流程 | [tauri-desktop.mjs](../../tests/tauri-desktop.mjs) `desktop.launch` 与 `tests/*e2e.mjs` | Tauri、Node、WebView2、实际请求及隔离工作库；文件选择和打印由调试管道提供可重复响应 |
| 独立结果审计 | `scripts/independent-*-check.py`、专项 oracle | 用输出、解析几何或原图建立独立预期；需说明哪些部分仍与生产代码共用 |
| 发布包与实物输出 | [tauri-release-e2e.mjs](../../tests/tauri-release-e2e.mjs)、实际打印与制作检查 | 包内资源和运行恢复；实体尺寸、贴合与外形另需对应实测记录 |

Vitest 当前以 Node 环境运行，最多 3 个测试 worker，缺省每项超时 15 秒；具体文件可覆盖。临时目录由 [test-unit.mjs](../../scripts/test-unit.mjs) 隔离到 `.local/tests/runtime-tmp`。并非所有集成测试都使用原生几何；不需原生求解的持久化测试可使用 [accepted-cut.ts](../../tests/fixtures/accepted-cut.ts)，不能把这种夹具当算法正确性的证明。

按改动范围选择相关完整文件。状态与事务修改应覆盖正常、失效和未审阅情况，并检查失败或取消后的项目、历史、恢复点与资源。涉及算法时，由负责算法实现的维护者检查独立预期、真实 worker、覆盖和制造结果。界面与 IPC 修改还需调试构建和对应桌面流程。各功能点完成后集中验证，失败后保留原始报告，修复后复跑受影响的完整范围。

示例是定向状态回归，不是全软件验收：

```cmd
npm test -- tests/integration/repository.test.ts tests/integration/repository-checkpoint.test.ts tests/integration/material-history.test.ts
```

## 隐藏桌面与可选复现

先准备原生 worker，再构建调试桌面：

```cmd
npm run build:rust
npm run build:desktop:test
npm run test:desktop
```

[test-desktop.mjs](../../scripts/test-desktop.mjs) 缺省串行，可用 `--jobs 1` 至 `--jobs 3`；Windows 上降低测试进程优先级。原生测试窗口保持隐藏，使用独立 WebView2 用户目录及工作库，避免激活用户正在操作的应用。隐藏运行不表示使用了假页面，组件夹具与真实 Tauri 流程须分别标注。

可显式选取脚本名，不带 `.mjs` 后缀：

```cmd
npm run test:desktop -- --jobs 2 recovery-e2e session-deletion-e2e
```

`--retest` 只复跑旧报告已有的指定套件，要求相同的构建描述，并归档先前报告。它不自动证明所有生产源码或包内二进制未变；最终仍需保存源码与产物哈希。默认桌面列表没有包含仓库所有可选脚本，新增专项脚本也不会仅因文件存在就加入批次。

桌面报告的 `sourceSha256`、`sourceUnchangedDuringRun` 当前只检查该套件的主 `.mjs` 文件，不覆盖它导入的帮助文件、生产代码或二进制。`testedBuild` 的路径和来源也不是完整产物哈希。要证明同一冻结构建，仍需另存相关源码、依赖及可执行文件的指纹。

[build-test-app.mjs](../../scripts/build-test-app.mjs) 可以在 `.local/tests/` 创建独立调试构建；测试需按其输出配置实际应用目录。部分复现脚本依赖捕获的工程、候选、图片或环境变量，执行前读取脚本和[测试索引](../../tests/README.md)。缺失样本应报告阻塞或未执行，不能改用简化矩形后声称原样本通过。

真实打印机不由调试打印路由代测。原生界面截图、浏览器夹具截图、命令调用记录和最终输出文件也分别证明不同结果，报告须注明截图来自哪种运行方式。

## 功能验收怎样记录

验证记录至少包含：

| 信息 | 记录要求 |
| --- | --- |
| 源码基准 | HEAD、未提交修改范围、涉及源文件及测试文件 SHA-256；只有提交号时说明未覆盖工作区变更 |
| 构建身份 | Node/Rust/平台、构建命令、实际 EXE、原生 worker 与关键资源哈希；说明是否同一冻结构建 |
| 输入 | 固定样本路径、来源或捕获说明、哈希、原图/模型版本、操作参数 |
| 执行 | 完整命令、开始时间、退出码、时长、执行了哪些文件、失败/跳过/中断范围 |
| 业务预期 | 从制作需求提出可观察结果，区分独立 oracle、生产代码重用和人为判断 |
| 输出证据 | 项目/候选、几何审计、实际 SVG/DXF/PDF、截图和重启后状态等相互对应的文件 |
| 结果边界 | 当前通过项、失败项、部分支持、未验证目标及依赖；重试保留原始失败记录 |

预期结果应来自需求、原始像素、实际尺寸或独立几何。不能为了通过而放宽业务阈值，也不能仅比较函数输出与同函数重算结果。与用户场景相关的全链验收需从原图/模型经过编辑、候选、接受、输出、保存和重开，不能用中间快照跳过发生过问题的步骤后宣称整链通过。

多轮回归的并集须明确各轮源码和构建。不得把基线、修复复跑与最终定向组相加，写成同一冻结版本的一次全量通过。测试数量还应分清文件数、测试项数、脚本数和制作样本数。历史通过记录不会自动随工作区更新而继续有效。

新日志和报告写 `test-results/`，不放 `Docs/`；修改说明写 `update/`。现有 [collect-evidence.mjs](../../scripts/collect-evidence.mjs) 可收集特定套件输出和文件哈希，但依赖已有文件，并将 `gitCommit` 写为 `null`，不能把收集脚本本身当作完整验收或提交身份校验。

## 文档任务与清理

### 当前保留的既有验收记录

[已报告流程的验收说明](../../tests/reported-functional-acceptance-contract.md)随 `0bd71c8` 保存。本轮回读了记录，但未重跑：历史完整 Vitest 基线的 JSON 含 366 个文件、2814 项通过；后续腿部上下文修改有独立受影响文件复测。桌面报告包含 68 套结果及复测记录，不是最终源码下重新运行全部套件的一次记录。

该说明还记录了一个实际 UI 计算的 36 片样本及其接受、保存重开和下游输出。片数和耗时只描述指定输入；大计算仍接近原时限，不能写成通用少片或即时完成。已有软件记录也不替代[制作交付核对](../planning/acceptance-matrix.md)及实物试样。

### 本轮检查边界

本轮文档任务只读取实现、整理当前能力和规划边界。文档本地链接检查应在全部文档落盘后统一执行；通过仅说明目标路径存在。没有运行类型检查、功能测试、原生求解或桌面流程时，交付说明须逐项如实注明，不能引用旧报告填成本次结果。

清理先查看 [clear-test-data.ps1](../../scripts/clear-test-data.ps1) 和 [prune-releases.ps1](../../scripts/prune-releases.ps1) 的实际目标，以 `-WhatIf` 预览。关闭相关测试进程，确认解析后的绝对路径及链接，再清理授权范围内的生成数据。保留用户库、固定样本、生产资源、工具链和本次需要的证据。`-IncludeLegacyProfile` 可包含 APPDATA 用户库，不属于普通测试缓存清理。

待落地功能与未验证目标见[需求规划](../planning/requirements.md)。最终报告引用本次实际执行结果，不把本文列出的命令或现有测试清单视为已经完成。

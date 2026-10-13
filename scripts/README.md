# 脚本导航

所有开发命令直接在仓库根目录执行。优先使用根目录 `package.json` 中的 npm 命令；直接运行脚本时也以仓库根目录为当前目录。

| 任务 | 入口 |
| --- | --- |
| Rust 编译、测试与工具链选择 | `cargo.mjs`，对应 `build:rust` / `test:rust` |
| Electron、工作线程和 Vue 构建 | `build.mjs`，对应 `build` |
| 启动已构建应用 | `start.mjs`，对应 `start` |
| Windows 发布包与最新版本指针 | `package.mjs`，对应 `package` |
| TypeScript、Rust、格式与构建验证 | `verify.mjs`，对应 `verify` |
| Vitest 单元与集成测试 | `test-unit.mjs`，对应 `test` |
| 桌面端测试套件 | `test-desktop.mjs`，对应 `test:desktop` |
| 数据契约生成 | `generate-contracts.mjs` / `.ts` |
| 字体与第三方资源声明 | `prepare-font.py`、`notices.mjs` |
| 独立导出与制造校验 | `independent-*-check.py` |
| 收集当前验证证据与源码清单 | `collect-evidence.mjs` |
| 文档链接校验 | `check-docs.mjs`，对应 `docs:check` |
| 本地测试数据与发布目录维护 | `clear-test-data.ps1`、`prune-releases.ps1`；`clear-legacy-builds.ps1` 是发布包清理的兼容入口 |

构建需要真实的 `target/release/fpcad-worker.exe`。打包脚本还需要安装完成的 Electron 运行时；仅执行 `npm ci --ignore-scripts` 不会下载该运行时。

清理脚本先使用 `-WhatIf` 检查目标。`.local/workspace/`、已有 `.tools/`、回归样本、生产资源和需要保留的发布包具有不同用途，不能统一视为缓存删除。

验证与独立校验的新报告写入 `test-results/evidence/`，发布清理报告写入 `test-results/release-cleanup.json`，不再向 `Docs/` 写入日志或截图。

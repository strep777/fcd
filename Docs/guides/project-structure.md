# 项目结构与开发入口

应用源码、依赖配置、构建和启动入口都直接位于仓库根目录。`package.json` 提供实际应用命令，Rust 工作区与前端配置也在同一层。

```text
fcd/
├── AGENTS.md                   # 开发协作规则与自动发现入口
├── README.md                   # 使用与开发入门
├── package.json                # 应用依赖与开发命令
├── 启动新版FurryCAD.cmd         # 启动最新本地发布包
├── apps/desktop/
│   ├── main/                   # Electron 服务、持久化、工作线程
│   └── src/                    # Vue 界面与编辑交互
├── packages/                   # 按领域划分的共享逻辑
├── crates/
│   ├── geometry-core/          # Rust 几何算法
│   └── worker/                 # 原生工作进程入口
├── assets/                     # 生产字体、资源和许可证声明
├── scripts/                    # 构建、运行、测试与维护脚本
├── tests/
│   ├── integration/            # TypeScript 集成与状态回归测试
│   ├── fixtures/               # 固定图片、数据和复用测试工厂
│   └── *.mjs / *.test.ts       # 桌面流程及领域专项测试
├── Docs/                       # 当前开发、架构与算法说明
├── Cargo.toml                  # Rust 工作区
└── rust-toolchain.toml         # 固定 Rust 工具链
```

## 按需求定位代码

| 需求 | 主要位置 |
| --- | --- |
| 会话、修订与撤销恢复 | `main/main.ts`、`main/repository.ts`、`src/store.ts` |
| 文件保存与交换 | `main/archive.ts`、`main/workflow-exchange.ts` |
| 数据契约与迁移 | `packages/schema/` |
| 花纹提取与原图编辑 | `packages/reference/`、`main/references.ts`、`main/library-region-edit.ts` |
| 模型与三维贴附 | `packages/surface/`、`main/surface.ts`、`main/markings.ts` |
| 花纹依赖指纹 | `main/marking-fingerprint.ts` |
| 裁切候选与历史 | `main/cut-preview.ts`、`main/cutting-library.ts` |
| 节点细分与接缝重映射 | `main/topology-edit.ts`、`packages/pattern/` |
| 材料、排料与实际尺寸输出 | `packages/manufacturing/`、`main/nesting.ts`、`main/export.ts` |
| 本机助手与配置 | `main/assistant-bridge.ts`、`main/assistant-settings.ts` |
| 原生几何算法 | `crates/geometry-core/src/`；协议入口在 `crates/worker/src/main.rs` |

表中的 `main/` 和 `src/` 均相对于 `apps/desktop/`。主流程为：渲染端 → preload API → 主进程请求队列与修订检查 → 领域服务/工作进程 → Repository 事务 → 统一会话状态。

## 本地内容的边界

| 路径 | 用途 | 管理方式 |
| --- | --- | --- |
| `node_modules/`、`.tools/` | npm 依赖与本地工具链 | 不提交；保留可用工具链 |
| `target/`、`target-*/` | Rust 编译缓存 | 不提交；可以重新编译生成 |
| `dist/` | 桌面应用构建产物 | 不提交；由构建脚本生成 |
| `release/` | 本地发布包与 latest 指针 | 不提交；分发时复制完整发布目录 |
| `.local/workspace/` | 用户工作库 | 保留和备份，不当作缓存清理 |
| `.local/tests/`、`test-results/` | 隔离测试数据与输出 | 不提交；按维护脚本清理 |
| `tests/fixtures/`、`assets/` | 回归样本与生产资源 | 属于源码，保持引用和许可证完整 |
| `Docs/guides/`、`Docs/design/` | 使用指南、开发入口和算法设计 | 维护当前说明 |
| `Docs/planning/` | 尚未落地的功能与技术规划 | 标明状态，不作为已实现能力 |
| `test-results/evidence/` | 新生成的验证证据 | 本地生成，不提交 |

应用直接在仓库根目录维护，本地工具链位于 `.tools/`。根目录 README 是统一入门文档，`Docs/` 保留当前开发和算法说明，历史记录通过 Git 追溯。

`target-balanced-review/` 编译缓存已取消版本控制跟踪，`target-*/` 忽略规则防止重新提交。旧源码清理脚本现在只代理发布包清理，不再删除根目录源码；发布包清理也限定在本仓库内。

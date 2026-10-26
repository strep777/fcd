# 桌面应用架构

基准日期：2026-10-26。应用版本：0.8.0。源码基准：`0bd71c8c4d460fe44663ebee5cc484218d8b0e38`。本轮开始时源码无未提交修改，文档按此提交核对；本轮只修改文档。

本文的“代码已存在”表示能定位到实现；“部分支持”只覆盖明确列出的范围；“规划”表示尚未落地。本次只核对源码和文档，运行、性能、打印及制作效果均为本次未验证。功能边界见[功能目录](../guides/feature-catalog.md)，操作顺序见[制作流程](../guides/user-workflow.md)。

## 进程与运行链

FurryPattern CAD 是面向 Windows 的离线桌面 CAD。Vue 3 和 Pinia 管理界面，Tauri 2 使用系统 WebView2 显示页面。Tauri 的 Rust 宿主启动随包携带的 Node.js 后台；后台持有 SQLite 数据库，调用领域服务、Node 工作线程和独立 Rust 几何进程。

```text
Vue 页面 / Pinia 会话
  → window.fpcad（受控 DesktopApi）
  → tauri-transport → Tauri desktop_request
  → Rust 宿主与 Node 后台之间的私有 stdin/stdout
  → main.ts 请求队列 / 领域服务
      ├─ Repository → workspace.sqlite
      ├─ surface / nesting / assembly 工作线程
      └─ fpcad-worker 原生几何进程
  ← Response / changed / storage-error / surface-progress / dialog-state
```

| 层 | 代码入口与职责 |
| --- | --- |
| 页面与交互 | [App.vue](../../apps/desktop/src/App.vue) 组织工作区；[store.ts](../../apps/desktop/src/store.ts) 的 `useSession` 发布统一会话、管理操作锁和页面错误 |
| 前端 API | [bridge-client.ts](../../apps/desktop/src/bridge-client.ts) 安装只读 `window.fpcad`；[tauri-transport.ts](../../apps/desktop/src/tauri-transport.ts) 的 `send` 创建请求 ID、登记可取消任务 |
| 原生宿主 | [src-tauri/src/main.rs](../../apps/desktop/src-tauri/src/main.rs) 的 `desktop_request`、`Backend`、`native` 管理窗口、后台管道、文件对话框及打印 |
| Node 后台 | [main/main.ts](../../apps/desktop/main/main.ts) 的 `handle`、`dispatch`、`startup` 校验请求、调度服务、写入状态并组装会话 |
| 持久化 | [repository.ts](../../apps/desktop/main/repository.ts) 的 `Repository` 管理事务、历史、恢复点、请求去重和内容资源 |
| 计算运行时 | [surface-runtime.ts](../../apps/desktop/main/surface-runtime.ts) 的 `runTask`、[worker.ts](../../apps/desktop/main/worker.ts) 的 `createWorkerSession` 管理线程或原生进程 |
| 可执行契约 | [schema/index.ts](../../packages/schema/index.ts) 的 `projectSchema`、`commandSchema`、`requestSchema` 定义跨层数据 |

当前桥接文件是 `tauri-transport.ts`，仓库没有参与此链路的 `preload.ts`。Tauri 宿主不直接执行业务事务，也不把数据库连接暴露给页面。

## 请求与数值传输

项目请求使用 `protocolVersion: 1` 和 UUID `requestId`。项目相关方法还要求 `projectId`、`expectedRevision`。后台经 `requestSchema` 校验后调用 `Repository.assertRevision`，避免旧页面或旧计算覆盖新状态。会话读取、新建和切换各有契约，不套用项目写命令字段。

`dispatch` 将普通桌面请求及本机助手请求放入同一条队列。`surface.cancel` 绕过队列，所以取消不必等待长任务结束。助手配置与助手启停走独立通道。后台通知提示页面刷新或显示任务状态，项目正文仍来自会话响应。

大项目响应经 `fpcad:request-text` 传递。Node 的 [host-wire.ts](../../apps/desktop/main/host-wire.ts) `replyFrame` 添加短帧头，Rust 的 [backend_wire.rs](../../apps/desktop/src-tauri/src/backend_wire.rs) `text_response` 保留后续 JSON 字节，避免宿主反复解析整份几何。请求侧 `serde_json` 启用了 `float_roundtrip`。这些实现针对坐标与依赖指纹的往返稳定性；本次未重跑对应测试。

[response-wire.ts](../../packages/api/response-wire.ts) 的 `encodeResponse` 只在同一回复内复用重复的大图片，`parseResponse` 在前端还原原始数据 URL。临时图片表不跨修订缓存，也不是持久化格式。

## 模块职责

共享纯函数按领域放在 `packages/`；需要文件、数据库、原生资源或进程权限的逻辑放在 `apps/desktop/main/`。当前由 `main.ts` 请求分派和 `Repository.commit` 命令分派连接业务，没有独立的服务容器或通用插件宿主。

| 领域 | 主要边界 |
| --- | --- |
| 原图与来源 | `packages/reference/` 处理图像、轮廓及贴附元数据；后台入口为 `references.ts`、`library-region-edit.ts` |
| 模型与曲面 | `packages/body/`、`packages/surface/` 保存参数、曲面与三维对应关系；后台组织生成、编辑及候选计算 |
| 二维编辑 | `packages/pattern/` 放路径、曲线和节点操作；页面草稿与已提交纸样分开 |
| 制造与输出 | `packages/manufacturing/`、`packages/nesting/` 管理材料、接缝、分页和排料输入；后台生成输出文件 |
| 项目生命周期 | `main/project-lifecycle.ts`、`main/cutting-library.ts` 维护活动模型、非活动模型记录和历史裁切快照 |
| 原生计算 | `crates/worker/` 处理 JSON 协议，`crates/geometry-core/` 提供算法；算法细节见设计目录对应文档 |

[modules/index.ts](../../packages/modules/index.ts) 的 `ModuleRegistry` 已有依赖排序、重复 ID 与循环检查、可选模块失败隔离和逆序释放逻辑，也有测试。生产 `main.ts` 只有导入，没有实例化和启动调用。模块生命周期属于部分支持，不能据此声称业务已经由注册表启动。第三方插件、公共 SDK 和插件商店仍属规划。

## 状态的归属

| 状态 | 存放位置 | 提交边界 |
| --- | --- | --- |
| 页面选择、相机、输入草稿、局部撤销 | Vue 组件及 `modules/`；[draft-history.ts](../../packages/ui/draft-history.ts) `DraftHistory`、[useDraftHistory.ts](../../apps/desktop/src/modules/useDraftHistory.ts) | 用户确认后才通过 API 写项目；局部撤销不等于数据库撤销 |
| 已提交项目 | SQLite `sessions.state`，由 `Repository.snapshot` 还原 | 成功命令立即持久化 |
| 表面及原图候选 | 项目的 `surfaceRun`、`previewMarkings`、`referenceRun` | 候选可以保存，须经接受操作才替换正式裁片或来源 |
| 缝份/偏移任务 | SQLite `jobs` 与 `JobManager` 的控制器 | 成功计算只写候选；接受时与项目命令共用事务 |
| 模型记录 | `modelLibrary` | 保存各模型的裁片、绑定、花纹与内部接缝 |
| 裁切历史 | `cuttingLibrary` | 接受后创建独立快照；当前编辑不改写旧快照 |
| 外部工程 | 用户选择的 `.fpcad` 文件 | 明确保存或另存；工作库提交不自动更新此文件 |

`useSession.run` 在项目操作期间加锁，成功后整体发布会话；`refresh` 用代次检查防止迟到读取覆盖新状态。错误归属发起操作的页面。界面锁协调交互，项目 ID、修订、哈希与事务仍由后台检查。

模型切换由 `saveActiveModel` 保存当前记录，`assertModelDetach` 检查模型裁片与独立纸样之间的接缝依赖，再恢复目标模型的状态并清除不再适用的候选与排料。切换模型不等于恢复某次历史裁切；后者由 `activateCut` 显式装回快照中的模型、裁片、绑定、花纹和接缝。

## 事务、恢复与文件保存

`Repository` 使用 Node 内置 `node:sqlite`，启用 WAL、`synchronous=FULL` 和外键。`commit` 在 `BEGIN IMMEDIATE` 事务中应用命令、递增修订、写入前后快照、命令游标、事件和请求记录；异常则回滚。候选接受可在同一事务中更新任务状态及恢复点。

撤销与重做移动历史游标，但修订号继续递增。恢复点还原也生成一条新命令。`replay` 检测同一会话的请求 ID，内容一致时避免重复写入，内容变化时报 `REQUEST_ID_REUSED`；响应返回当前会话，不承诺返回首次执行时的旧页面状态。

`main.ts` 的 `autosave` 负责恢复点：空闲 3 秒写入，持续编辑最长等 30 秒，最多保留 10 个恢复点。每次命令此前已提交 SQLite。恢复点不代替用户保存 `.fpcad`。外部保存先构建并回读工程包，再经 `atomicWrite` 写临时文件、同步并替换，成功后记录保存修订。格式见[项目数据与契约](data-contracts.md)。

启动时数据库执行完整性检查。活动项目无法解析时，保留项目、历史和恢复记录，仅取消活动指针并报告 `PROJECT_INVALID`。删除本地会话则原子删除其历史和任务，以所有剩余状态、历史和资源引用为根回收内容。后续空间整理失败单独报告 `STORAGE_RECLAIM_FAILED`，不把已完成删除报告成失败。外部工程文件不在删除范围。

## 长任务、取消与失败

表面任务在线程中运行，结果经 Zod 校验后才交回请求处理器。线程不持有项目写入权。后台接受结果前检查取消信号和输入修订，再提交候选或正式状态。

[surface-task-queue.ts](../../apps/desktop/main/surface-task-queue.ts) 的 `SurfaceTaskQueue` 在排队前登记任务，按项目、修订与请求 ID 取消；它保留提前到达的精确取消 ID，覆盖大图片请求尚未进入队列的情况。支持取消的方法集中在 [cancellable-methods.ts](../../packages/schema/cancellable-methods.ts)，不能把所有耗时操作都描述成可取消。

`surface-runtime.ts` 跟踪线程启动的原生子进程，结束或取消时终止线程并确认子进程退出。[native-process.ts](../../apps/desktop/main/native-process.ts) 的 `terminateNativeProcess`、`terminateNativeChildren` 处理退出确认。`worker.ts` 有单次请求和单个计算任务内顺序复用的流式会话，后者不跨项目或任务共享。

| 代码已存在的限制 | 作用及边界 |
| --- | --- |
| 桌面请求 64 MiB | Tauri 与 Node 入口均限制；不是工程文件总容量指标 |
| 表面线程堆 1024 MiB | `runTask` 的线程设置；不是整个应用内存上限 |
| 表面任务超时 | 通用值 120 秒；裁切预览按输入估算，范围 60–900 秒；不是完成时间承诺 |
| 原生请求预算 | 单次请求和批分析分别限制字节数及超时，返回还需检查实体 ID 与数量 |
| 排料与组装 | `runNesting` 搜索 10 秒，超时可返回已取得的合法基线；`runAssembly` 超时 20 秒 |
| 偏移任务 | `JobManager` 最多登记 4 个运行控制器；候选关联会话、基础修订、输入哈希与算法版本 |

[JobManager](../../apps/desktop/main/jobs.ts) 启动时将中断的排队/运行任务标为失败，将算法版本变化的成功候选标为过期。接受时复核基础修订、输入内容、结果哈希及几何问题。主请求边界将 `DomainError` 映射为业务错误码，Zod 错误映射为 `VALIDATION_ERROR`，其他异常映射为 `IO_ERROR`。错误码不能替代完整故障诊断。

## 输出与本机助手

[export.ts](../../apps/desktop/main/export.ts) 的 `gate` 检查材料、花纹依赖、接缝、绑定、几何及警告确认。正式输出使用毫米，SVG、DXF 与分页 PDF 保留 100 mm 校验尺。PDF 按 `72/25.4` 换算点，不使用屏幕缩放。PNG 由 [png.ts](../../apps/desktop/main/png.ts) `pngExport` 生成，是带 144 DPI 物理元数据的预览。裁片 ZIP 可以保存尚未达到制造条件的草稿，此时不生成制造预览；可交换不代表可制作。

助手有两个独立入口：

- [assistant-bridge.ts](../../apps/desktop/main/assistant-bridge.ts) 的 `AssistantBridge` 在用户开启后监听随机本机回环端口，以会话令牌和方法/命令白名单授权外部助手。CAD 请求仍经过项目队列、修订与事务检查；关闭连接撤销尚未执行的桥接请求权限。
- [assistant-settings.ts](../../apps/desktop/main/assistant-settings.ts) 的 `AssistantSettings` 保存提供商、模型选择、文本技能与 MCP 配置，支持模型列表及 MCP 握手/工具列表测试。API 密钥由 [windows-vault.ts](../../apps/desktop/main/windows-vault.ts) `windowsVault` 用当前 Windows 用户 DPAPI 保护。

配置页与连接测试属于部分支持。当前没有内置聊天推理循环、技能执行器、MCP `tools/call` 调度或 ONNX 模型运行时；这些不能从模型列表可读取推断出来。账号、商业授权、项目云同步和自动更新服务仍属[后续规划](../planning/roadmap.md)。

## 部署与运行边界

生产资源包含渲染页面、Node 后台、Node 运行时、原生工作进程、Canvas 原生依赖、字体及 WASM。`build:frontend` 复制当前 Node 可执行文件，不会下载独立固定运行时。Tauri 使用系统 WebView2，安装包目标为 Windows NSIS；便携包标记为未签名的内部开发预览。命令见[开发与验证](../guides/development-and-validation.md)。

通过 `npm start` 启动时，脚本缺省使用仓库 `.local/workspace/`。直接 EXE 或安装版缺省使用 `%APPDATA%/FurryPatternCAD/`。两者均可由 `FPCAD_DATA_DIR` 覆盖，工作库内的 `workspace.sqlite` 才是会话数据。排障前需确认实际启动方式和数据目录。

宿主只允许 `main` 窗口调用固定通道；导航限制在本地 Tauri 来源，阻止新窗口。CSP 与 [capabilities/main.json](../../apps/desktop/src-tauri/capabilities/main.json) 限制渲染端能力。普通桌面链路使用私有管道，不开业务 HTTP 端口；开启本机助手后才出现回环桥。提供商和 MCP 测试由 Node 发起，不是离线 CAD 的启动依赖。

正常窗口在后台 ready 后显示。关闭窗口先通知 Node 停止助手、取消表面任务、等待队列、写恢复点并释放数据库。调试桌面测试以 `--fpcad-background-test` 启动隐藏窗口，避开正常单实例；调试专用 `test_control` 不编入发布版。

## 性能与维护要求

代码已有几何缓存、批量原生分析、SQL 内容去重、大图片单回复复用、`markRaw` 大数据、独立线程和任务预算。这些说明资源控制手段存在，不能证明所有模型都能在指定耗时或内存指标内完成。整项目克隆、契约解析与 JSON 序列化仍有成本，性能验收需覆盖这些步骤。

维护时检查下列边界：

- 数据字段从 Zod 契约开始变更，同时检查归档、SQL 资源引用、非活动模型、裁切快照和生成契约，不能只改活动页面。
- 后台写入集中走 `Repository`；线程只交付结果。内部派生命令由领域入口生成，普通 `command.apply` 会拒绝直接伪造其中一部分结果。
- 来源哈希与审阅状态分别处理。更新依赖不能让原本过期的依赖变为有效，也不能自动批准未审阅推断。
- 新任务同时设计取消、资源释放、失败后状态和撤销；共享纯函数归入领域包，减少页面及请求分派中的重复逻辑。
- 报告绑定源码和构建。测试存在、旧报告通过和构建成功分别只证明各自范围；制作效果需要对应样本及实际输出证据。

后续需求与未验证目标见[需求规划](../planning/requirements.md)。本次文档核对没有运行功能测试。

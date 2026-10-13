# 桌面应用架构

应用采用 Electron、Vue 3、TypeScript、Pinia 和 SQLite；Rust 工作进程负责原生几何计算。开发、构建和运行入口均位于仓库根目录。

## 请求与状态链路

Vue 页面 → `preload.ts` 暴露的受控 API → `main.ts` 请求队列与修订检查 → 领域服务或工作进程 → `Repository` 事务 → 统一会话状态。

- `apps/desktop/src/store.ts` 保存统一会话，并协调交互锁和刷新。页面共用项目状态。
- `apps/desktop/main/preload.ts` 限定渲染端可调用的方法；主进程检查请求来源和数据契约，保留沙箱与上下文隔离。
- `apps/desktop/main/repository.ts` 管理 SQLite 会话、命令历史、恢复点、请求重放与资源存储。写入失败整体回滚；撤销与重做继续使用递增修订号。
- `packages/schema/index.ts` 是项目和命令的可执行数据契约；格式迁移与兼容判断从这里开始。

## 计算与确认

耗时任务通过工作线程或独立进程执行。Rust 入口位于 `crates/worker/src/main.rs`，算法位于 `crates/geometry-core/`；主进程负责协议、超时、资源预算和取消。

计算候选与已确认裁片分开。确认时核对项目修订、来源哈希、几何有效性和审阅状态；取消或过期结果不能覆盖当前编辑。`cutting-library.ts` 保存确认后的裁切快照，`project-lifecycle.ts` 保存各模型对应的状态。

## 编辑与输出约束

三维模型、二维裁片和花纹通过绑定、原始面和重心坐标保留对应关系。轮廓或模型变化后，相关绑定与来源指纹必须同步更新或标记为失效。精确节点细分只能更新此前匹配的依赖，不能自动批准推断花纹。

内部几何统一使用毫米。材料、缝份、剪口、接缝和排料经过制造检查后，才生成 SVG、DXF、PDF 或 PNG；屏幕缩放与实际尺寸分页分开。拼接预览还原保存的几何位置，不模拟布料张力。

代码定位见[项目结构](../guides/project-structure.md)，数据关系见[项目数据与契约](data-contracts.md)。具体参数和预算以当前源码及对应测试为准。

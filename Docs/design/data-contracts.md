# 项目数据与契约

## 主要数据关系

| 数据 | 作用 |
| --- | --- |
| `references`、`patternLibrary` | 原始图片、标定和可编辑花纹来源 |
| `surface`、`modelLibrary` | 当前模型及各模型保存的独立状态 |
| `markings` | 模型表面花纹、来源、审阅状态和三维/二维对应关系 |
| `surfaceRun`、`previewMarkings` | 计算中的展开或裁切候选 |
| `pieces`、`bindings` | 已确认裁片及其对应的三维几何 |
| `cuttingLibrary` | 可恢复的确认裁切快照 |
| `materials`、`seams`、`nesting` | 材料、接缝关系和排料结果 |

字段和限制以 `packages/schema/index.ts` 中的 Zod 契约为准；生成的 JSON Schema 位于 `packages/schema/generated/`。文档不另行维护一套模式副本。

## 持久化与交换

`Repository` 将提交状态、历史和恢复点写入 SQLite，大型不可变图片与模型资源以内容哈希去重。写命令携带项目 ID、预期修订号和请求 ID，避免旧结果覆盖及重复提交。

`.fpcad` 文件由 `apps/desktop/main/archive.ts` 管理，导入执行路径、大小、契约和内容哈希校验；保存采用临时文件与原子替换。制作流与裁片 ZIP 的交换入口是 `workflow-exchange.ts`。

## 依赖完整性

裁片、绑定和花纹来源均保留几何或内容指纹；推断花纹还记录源花纹指纹和审阅状态。过期绑定、未审阅推断或失效来源阻止制造输出。

材料删除需检查当前裁片、花纹库、非活动模型、裁切快照和计算候选。切换模型或恢复裁切版本时，不能丢失关联裁片和接缝。相关回归见 `tests/integration/topology-provenance.test.ts`、`material-history.test.ts` 与 `repository.test.ts`。

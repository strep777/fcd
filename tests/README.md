# 测试目录

| 位置 | 内容 |
| --- | --- |
| `integration/*.test.ts` | TypeScript 集成测试、事务和状态回归 |
| 根目录 `*.test.ts` | 几何、材料和设计裁切专项测试 |
| `fixtures/`、`fixtures.ts` | 固定输入与测试工厂；不是生成输出 |
| 根目录 `*-e2e.mjs` | 使用隔离数据的 Electron 桌面流程 |
| `desktop-*.mjs` 等辅助文件 | 测试启动、截图与运行支持 |
| `../crates/` 内的 Rust 测试 | 原生几何算法验证 |

在仓库根目录运行 `npm test`；选择套件时用 `npm test -- tests/integration/某套件.test.ts`。Vitest 的文件范围由 `vitest.config.ts` 定义。

新增状态回归套件：

- `topology-provenance.test.ts`：精确细分、推断依赖、审阅与锁定、输出门禁、撤销和文件往返。
- `anatomy-inference-provenance.test.ts`：分类元数据变更保留有效推断依赖、既有审阅状态和失效依赖。
- `anatomy-binding-provenance.test.ts`：部位分类保留失效绑定，验证导出门禁、有效依赖更新、撤销和历史快照。
- `cut-candidate-provenance.test.ts`：真实裁切候选的输入指纹、失败事务、撤销后接受、文件往返与旧候选兼容性。旧版已接受快照仍可读取；缺少输入指纹的未接受候选需要重新计算。
- `paw-pad-shared-chain.test.ts` 和 `fixtures/paw-pad-shared-chain.json`：真实原图爪垫共享边界的尖折、像素误差、固定端点，以及缩放和旋转后的恢复结果。
- `material-history.test.ts`：历史裁切对材料的依赖、失败事务和历史恢复。
- `fixtures/accepted-cut.ts`：无需原生求解即可构造的平面裁切快照；先按契约规范化，再计算哈希。

涉及原生计算的测试需要先运行 `npm run build:rust`。桌面测试还需要构建应用；运行方法见根目录 README 和 `../scripts/README.md`。临时数据仅放入 `.local/tests/` 或 `test-results/`，不要使用 `.local/workspace/`。

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

- `launcher.test.ts`：Windows BAT 启动编排，覆盖中文和空格路径、首次安装、参数转发及各阶段失败中止；使用命令记录器，不替代真实几何或桌面验证。

- `topology-provenance.test.ts`：精确细分、推断依赖、审阅与锁定、输出门禁、撤销和文件往返。
- `anatomy-inference-provenance.test.ts`：分类元数据变更保留有效推断依赖、既有审阅状态和失效依赖。
- `anatomy-binding-provenance.test.ts`：部位分类保留失效绑定，验证导出门禁、有效依赖更新、撤销和历史快照。
- `cut-candidate-provenance.test.ts`：真实裁切候选的输入指纹、失败事务、撤销后接受、文件往返与旧候选兼容性。旧版已接受快照仍可读取；缺少输入指纹的未接受候选需要重新计算。
- `paw-pad-shared-chain.test.ts` 和 `fixtures/paw-pad-shared-chain.json`：真实原图爪垫共享边界的尖折、像素误差、固定端点，以及缩放和旋转后的恢复结果。
- `material-history.test.ts`：历史裁切对材料的依赖、失败事务和历史恢复。
- `fixtures/accepted-cut.ts`：无需原生求解即可构造的平面裁切快照；先按契约规范化，再计算哈希。

涉及原生计算的测试需要先运行 `npm run build:rust`。桌面测试还需要构建应用；运行方法见根目录 README 和 `../scripts/README.md`。临时数据仅放入 `.local/tests/` 或 `test-results/`，不要使用 `.local/workspace/`。

花纹边缘保真回归：

- `integration/contour-edge-fidelity.test.ts`：低斜率长边、旋转细条、锐角菱形与共享边界。
- `integration/contour-edge-adversarial.test.ts`：通过颜色选区输入独立检查直边折点、双向边界误差、面积、真实凹口、孔洞和固定原图曲线。
- `integration/reference-fit-fidelity.test.ts`：高级自定义拟合的直边保持、原图像素与毫米双重误差限制、精确孔洞和资源不足时回退。
- `contour-edge-evidence.mjs`：运行 `node tests/contour-edge-evidence.mjs`，从 Git HEAD 读取对照算法并生成当前对比图与指标，输出到 `test-results/edge-fidelity/`。
- `integration/contour-default-real-edge.test.ts`：实际正背原图默认提取流程、皇冠直斜边、全网络缩放与旋转；输出原图叠加证据至 `test-results/current-task/`。
- `integration/reference-native-validity.test.ts`：不同原图分辨率和另一张实际设定图的原生有效性，包含共享链内微小自交回归。
- `contour-image-boundary-audit.mjs`：源图颜色变化诊断；梯度峰值不是模糊图像的真实边界标注。

模型交互与裁切进度回归：

- `integration/surface-free-brush.test.ts`：无选中花纹的新笔刷、圆形与方形尺寸、跨部位与分离投影、失败不写入、撤销重做和文件往返。
- `surface-edit-projection.test.ts`：曲面节点深度、遮挡层次、部位限制与轮廓裁至模型边缘。
- `integration/surface-progress-runtime.test.ts`、`integration/surface-progress-preload.test.ts`：真实阶段协议、限流、取消、迟到事件和订阅清理。
- `surface-inspector-render.mjs`：实际 Vue 检查器渲染，检查侧面补全面板、新建截面环线入口的移除与历史数据编辑入口的保留；不替代桌面鼠标交互。
- `surface-panel-component.mjs`：实际 Vue 组件的圆/方笔刷首次预览、按下拖动保存，以及旋转视角后的曲面轮廓与节点位置、拖动暂存和确认保存。使用自定义渲染器与 DOM/IPC 替身，报告至 `test-results/surface-panel-component.json`，不替代 Electron 显示验收。

当前模型编辑与原图证据专项：

- `image-contour.test.ts`、`integration/image-contour-independent.test.ts`：独立解析图形及 RGB 采样，覆盖斜直线、圆弧、波浪边、月牙尖端、孔洞、共享边界与低对比度，不以算法自己的输出作为误差真值。
- `model-transform.test.ts`、`integration/model-transform-project.test.ts`：对象／部位／顶点变换、裁线曲面对应、花纹依赖、失败事务与撤销。
- `integration/source-drop-locality.test.ts`：真实胳膊落点、遮挡、同部位名的断开网格、缩小后原锚点离开轮廓。
- `integration/design-freehand-allowance.test.ts`：跨三角形的自由裁线、二维与三维面积守恒、0 / 100 mm 缝份及过期候选拒绝。

以下脚本使用实际 Vue SFC、自定义渲染器及受控 DOM／IPC；有些调用真实 Rust。它们验证交互和数据结果，不能代替 Electron／GPU 显示验收：

```powershell
node tests/model-viewport-component.mjs
node tests/cut-selection-component.mjs
node tests/assembly-preview-component.mjs
node tests/model-manufacturing-controls-component.mjs
node tests/unwrap-lifecycle-component.mjs
node tests/source-region-locality-component.mjs
node tests/surface-scope-component.mjs
```

`source-region-locality-component.mjs` 还需要 `test-results/current-task/real-cut-project.json` 的真实项目副本与 locality 集成测试输出；不读取或修改用户项目库。`surface-viewport-host.mjs` 是共用测试宿主，不是独立测试入口。新生成的本轮验证结果放在 `test-results/current-task-2/`。

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
- `fixtures/blue-white-material-partition-baseline.json`、`real-blue-white-source-anchors.mjs`：蓝白原图的完整组件像素基线、独立材料定位点与深蓝内部覆盖检查；更新基线须重新核对原图，不能只修改期望数量。

涉及原生计算的测试需要先运行 `npm run build:rust`。桌面测试还需要构建应用；运行方法见根目录 README 和 `../scripts/README.md`。临时数据仅放入 `.local/tests/` 或 `test-results/`，不要使用 `.local/workspace/`。

花纹边缘保真回归：

- `integration/contour-edge-fidelity.test.ts`：低斜率长边、旋转细条、锐角菱形与共享边界。
- `integration/contour-edge-adversarial.test.ts`：通过颜色选区输入独立检查直边折点、双向边界误差、面积、真实凹口、孔洞和固定原图曲线。
- `integration/reference-fit-fidelity.test.ts`：高级自定义拟合的直边保持、原图像素与毫米双重误差限制、精确孔洞和资源不足时回退。
- `contour-edge-evidence.mjs`：运行 `node tests/contour-edge-evidence.mjs`，从 Git HEAD 读取对照算法并生成当前对比图与指标，输出到 `test-results/edge-fidelity/`。
- `integration/contour-default-real-edge.test.ts`：实际正背原图默认提取流程、皇冠直斜边及全网络缩放与旋转。三个尖端窗口由固定原始 JPEG 的 RGB 支持确定，检查窗口内外的有限边界、相邻 owner 和孔洞；原始 raw 误差仍单独报告。输出至 `test-results/current-task-2/source-tip-contract/`，不表示全图连续边界已验收。
- `integration/source-tip-source-fixture.test.ts`、`integration/source-tip-domain.test.ts`：固定 JPEG 的 15 项源支持检查，以及 9 项有限线段分区回归。窗口、源图哈希和 cap 资格不依赖输出；ROI 只选择测量点，最近目标保留同一 cap 分区的完整有限段。
- `integration/noisy-line-tip.test.ts`：两项含确定性 RGB 噪声的锐角正例及四项圆角／平头负例；六项都检查最终共享网络、原始 alpha、材料 core 和 1.5 px 源几何误差，不按输出尖端位置筛掉负例。
- `integration/contour-curved-cusp.test.ts`：8 项解析图形检查曲线相交尖端、窄月牙、真实圆端、圆形与孔洞。检查完整共享网络的双向边界误差、面积、拓扑、材料归属和输入不变，输出至 `test-results/contour-curved-cusp/`。
- `integration/image-tip-touching.test.ts`：24 项接触窗口回归，覆盖开放／闭合、反向、闭合起点、分数顺序及 observed/source 不同的输入。公共源 anchor 只保留一次，外部 cubic 几何保持精确；插值生成的切点沿用拼接测试的 `1e-10` 容差。
- `integration/image-tip-window-priority.test.ts`：24 项窗口仲裁回归，覆盖开放／闭合、反向和跨起点，以及无效高排名窗口后的有效近邻、全部无效时零分配、有效第一名不重复。复用固定源几何并直接供给候选模型，检查局部拼接和输入不变；不替代 RGB 推断或最终共享网络验收。
- `integration/reference-native-validity.test.ts`：不同原图分辨率和另一张实际设定图的原生有效性，包含共享链内微小自交回归。
- `integration/shared-contour-local-fallback.test.ts`：局部拟合失败后保留其它正确共享边，覆盖邻区检查顺序、证据撤回、孔洞及坐标变换。
- `integration/contour-line-tip-inference.test.ts`、`integration/contour-line-tip-adversarial.test.ts`：从独立源 RGB 和原始轮廓检查模糊尖端、真实平头与圆端、第三材料、透明像素及多标定共享网络。尖端真值来自模糊前的两侧直线交点，允许恢复到可见模糊边界之外。
- `integration/image-tip-source-contracts.test.ts`：源路径的双向距离、解析曲线、凹口与窄尖峰，以及非有限输入、工作预算和三材料共享交点。
- `integration/image-tip-splice.test.ts`：局部尖端窗口的原曲线保留、闭合起点、重叠与过远证据拒绝，以及反向共边控制点和输入不变。
- `integration/image-tip-evidence-cache.test.ts`：已读 RGB/alpha 变化、未读像素、图像对象隔离、返回值污染、异常及缓存预算；不替代源图模型的正确性验收。
- `integration/shared-contour-source-prepare.test.ts`：准备结果缺链、自交、非有限或超预算时回退，回调接收者和节点／控制点的毫米单位一致性。
- `integration/source-blended-materials-safety.test.ts`：颜色混合带的归属，覆盖真实第三色、白色条带、透明像素和计算预算耗尽后的完整回退。
- `integration/pink-instance-bounds.test.ts`：肉垫局部计算窗口的边界和输入契约，覆盖图角、孔洞、离散区域及原图像素归属。
- `contour-image-boundary-audit.mjs`：源图颜色变化诊断；梯度峰值不是模糊图像的真实边界标注。

尖端恢复在原生像素坐标中比较 Gaussian 模糊下的尖角、平头和圆端模型。局部拼接只替换原图证据支持的窗口，共享交点在拟合前统一准备；失败后仍须保留原边界、孔洞和材料归属。小型契约测试通过，不代表真实 JPEG 的所有细节已通过视觉验收。每轮报告应记录实际入口、源码指纹、失败和跳过项；缺少私有样本而提前返回的用例不能记为已覆盖。

模型交互与裁切进度回归：

- `integration/surface-free-brush.test.ts`：无选中花纹的新笔刷、圆形与方形尺寸、跨部位与分离投影、失败不写入、撤销重做和文件往返。
- `surface-edit-projection.test.ts`：曲面节点深度、遮挡层次、部位限制与轮廓裁至模型边缘。
- `integration/surface-progress-runtime.test.ts`、`integration/surface-progress-preload.test.ts`：真实阶段协议、限流、取消、迟到事件和订阅清理。
- `surface-inspector-render.mjs`：实际 Vue 检查器渲染，检查侧面补全面板、新建截面环线入口的移除与历史数据编辑入口的保留；不替代桌面鼠标交互。
- `surface-panel-component.mjs`：实际 Vue 组件的圆/方笔刷首次预览、按下拖动保存，以及旋转视角后的曲面轮廓与节点位置、拖动暂存和确认保存。使用自定义渲染器与 DOM/IPC 替身，报告至 `test-results/surface-panel-component.json`，不替代 Electron 显示验收。

当前模型编辑与原图证据专项：

- `image-contour.test.ts`、`integration/image-contour-independent.test.ts`：独立解析图形及 RGB 采样，覆盖斜直线、圆弧、波浪边、月牙尖端、孔洞、共享边界与低对比度，不以算法自己的输出作为误差真值。
- `integration/contour-independent-acceptance.test.ts`：从默认导入入口检查硬边与抗锯齿斜线、浅色弯曲边界、真实尖角、小孔和颜色归属，并比较独立解析真值。
- `integration/material-step-preservation.test.ts`：保留有明确色阶的浅色花纹和 4×4 小孔，检查渐变阴影与孤立噪点仍被过滤。
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

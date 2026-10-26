# 测试目录

桌面回归使用 Tauri 调试版和真实 WebView2：先执行 `npm run build:frontend` 与 `node scripts/tauri.mjs build --debug --no-bundle`，再运行 `npm run test:desktop`。`tests/tauri-desktop.mjs` 连接隔离测试窗口；文件选择与打印路由通过仅限调试版的测试管道返回结果，发布版不包含测试 command。组件浏览器夹具使用无界面的 Edge；实际打印机输出仍需检查 100 mm 校验尺。

`node tests/tauri-security-e2e.mjs` 检查窗口权限、导航限制和前端隔离。生成便携包后，运行 `node tests/tauri-release-e2e.mjs` 验证发布版自带的后台与几何进程、100 mm 尺寸、正常关闭和重启恢复；测试使用独立项目库。

`node tests/apple-workspace-e2e.mjs` 验证浅色桌面工作区：三种窗口尺寸、三种语言、八个制作阶段、项目对话框、助手设置、记录面板和减少动态效果。测试使用隔离项目库与隐藏 WebView2 窗口，截图及结果写入 `test-results/current-task-closed/apple-ui-representative/`。

`node tests/embedded-image-browser.mjs` 通过现有组件夹具在无界面的 Edge 中渲染真实 `EmbeddedImage.vue`。测试生成超过 64 KiB 的 PNG，核对 Blob URL 的原始文件字节、完整分辨率解码像素，以及真实 SVG 截图的全部 RGBA 像素；同时检查 SVG 属性透传、共享引用、换图和卸载释放。报告、像素证据与截图位于 `test-results/embedded-image/`。此项是浏览器组件验收，不启动 Tauri 应用。

`node --import ./tests/desktop-child-process.mjs tests/surface-texture-lifecycle-browser.mjs` 在无界面的 Edge 中挂载真实 `SurfaceGpu.vue`、`SurfaceCanvas.vue`，检查原生图像解码、纹理复用、换图及卸载取消、迟到解码、Canvas 同尺寸重绘和尺寸变化后的实际像素。受控等待只延后真实解码结果的交付，不替换像素。报告与源码 SHA256 位于 `test-results/surface-texture-lifecycle-browser/`。上述浏览器测试均记录测试脚本及相关生产组件的源码 SHA256。

Coordinated repair verification (functional results and remaining performance/visual limitations):
[`current-repair-test-plan.md`](current-repair-test-plan.md). The independent
[`independent-cut-correspondence.mjs`](independent-cut-correspondence.mjs) audit
accepts explicit input/candidate JSON files, checks source coverage, shared seam
lengths and 2D/3D correspondence, and writes to `test-results/current-repair/`.
Its analytic positive/negative checks are in
[`independent-cut-correspondence-oracle.mjs`](independent-cut-correspondence-oracle.mjs).
The finite-polyline Hausdorff oracle has additional analytic regressions in
[`independent-outline-distance-oracle.mjs`](independent-outline-distance-oracle.mjs),
including long boundaries with errors immediately below and above 0.0001 mm.
Seam-solver acceptance fixtures and pending native-integration checks are listed
in [`seam-solver-acceptance-contract.md`](seam-solver-acceptance-contract.md).
`node tests/seam-correspondence-regression.mjs --prepare-only` prepares eleven
analytic fixtures without launching a worker; omit the flag to exercise the
independent audit. `integration/seam-failure-acceptance.test.ts` checks the real
seam acceptance guard and state integrity, plus valid acceptance/undo/redo. Run
that suite against the production guard; it uses no geometry substitute or
simulated exception. `integration/seam-provenance-acceptance.test.ts` also checks
empty candidates, missing or duplicate bindings, disconnected or duplicated
provenance, inverted interiors and non-unit barycentrics through real acceptance
transactions, while retaining legitimate historical solver compatibility.

| 位置 | 内容 |
| --- | --- |
| `integration/*.test.ts` | TypeScript 集成测试、事务和状态回归 |
| 根目录 `*.test.ts` | 几何、材料和设计裁切专项测试 |
| `fixtures/`、`fixtures.ts` | 固定输入与测试工厂；不是生成输出 |
| 根目录 `*-e2e.mjs` | 使用隔离数据的 WebView2 桌面流程 |
| `embedded-image-browser.mjs` | 真实浏览器中的 SVG 原图像素与 Blob URL 生命周期 |
| `surface-texture-lifecycle-browser.mjs` | 真实图像解码、GPU 纹理复用、取消与迟到结果、Canvas 像素及缓冲尺寸 |
| `desktop-*.mjs` 等辅助文件 | 测试启动、截图与运行支持 |
| `../crates/` 内的 Rust 测试 | 原生几何算法验证 |

在仓库根目录运行 `npm test`；选择套件时用 `npm test -- tests/integration/某套件.test.ts`。Vitest 的文件范围由 `vitest.config.ts` 定义。

`reported-functional-acceptance-e2e.mjs` 使用真实 JPEG 和默认 DTD／一体填充模型，核对尾腿分离、裁片数量与尺寸、简单制版入口；验收条件见 [reported-functional-acceptance-contract.md](reported-functional-acceptance-contract.md)。原图取点、像素颜色和持久化矢量归属由独立夹具检查，模型裁切使用真实 Rust 工作进程。`integration/default-body-placement.test.ts` 检查默认填充模型正面、背面和侧面共 15 处贴附及草稿／保存一致性；`integration/mapping-domain-priority.test.ts` 检查相邻面的归属与二维／三维往返。

新增状态回归套件：

- `integration/open-seam-patterns.test.ts`：真实工作进程验证两点开放裁线、平面分片、圆筒展开、毫米面积、花纹对应、候选接受、撤销重做和无效路径的失败完整性。
- `integration/flat-pigments.test.ts`：同色系硬边分色、连续渐变、明暗阴影和细小噪点，检查完整提取结果和像素归属。
- `integration/library-metadata-registration.test.ts`：分类修正、缺少目标部位、未定侧、多部位合并、失效依赖和活动／保存模型的手工编辑保护。
- `integration/pattern-preview-independent.test.ts`：候选与已保存几何隔离、全部裁片总览、选中裁片消失及预览窗口尺寸变化。
- `node tests/reference-view-controls-component.mjs`：执行真实提取页组件，检查双视图顺序、单张图朝向、普通重提取与显式交换正背，以及忙碌状态下的控件；IPC 和相邻面板使用隔离夹具。
- `node --import ./tests/desktop-child-process.mjs tests/reference-candidate-controls-e2e.mjs`：隐藏 WebView2 中点击正背控件、重提取和交换，使用真实展开候选检查切边隔离与二维预览适配，保存截图及项目不变检查结果。
- `node tests/current-brush-component.mjs`：曲面钢笔开放／闭合切换、两点开放缝、局部草稿撤销重做、保存失败保留和已存路径检查。
- `integration/delayed-activity.test.ts`、`integration/dialog-activity-transport.test.ts`、`integration/native-dialog-state.test.ts`：区分操作锁与可见加载，检查连续文件选择、取消、异常、并发对话框、监听注册和卸载计时器。
- `integration/output-dialog-order.test.ts`：导出位置全部确认后才计算和写入，取消第二次选择保留保存修订、历史与文件状态。
- `loading-lifecycle-e2e.mjs`：隐藏的真实 Tauri / WebView2 验证打开、另存为、图片与模型导入、导出在选择期间不显示加载，实际文件处理期间显示活动动画，并检查取消、重复点击和失败后重试。结果位于 `test-results/loading-lifecycle/`。
- `build-output-lock.test.ts`：用真实 Windows 子进程占用运行时，验证构建在清理前拒绝文件占用，退出进程后可重新构建。
- `integration/archive-domain-validation.test.ts`：归档按模块读取、统一校验后，仍能拒绝无效业务数据，并保持小数坐标与项目往返一致。
- `integration/repository-checkpoint.test.ts`：新写入状态复用于恢复点，检查资源完整性、失败回滚、撤销重做与事务外误用。
- `integration/host-wire.test.ts`、`integration/raw-response-transport.test.ts` 与 Tauri 的 `backend_wire.rs`：原始字节传输保持数字、中文和换行内容，兼容普通对象通道与旧字符串回复。
- `integration/response-wire.test.ts`：同一回复中的大图片只传一份，覆盖真实 PNG/JPEG/WebP、当前与历史模型纹理、完整回复往返、坐标精度、旧 JSON 兼容及异常索引拒绝。
- `integration/repository-metadata.test.ts`：文件选择只读取当前项目名称和保存路径，切换项目后保持正确归属；真正读取资源时仍拒绝损坏内容。
- `full-performance-e2e.mjs`：单独运行大项目拖动、三维旋转、反复打开及内存测量；核对实际 WebView2 开关，保留原生动画帧，报告后台各阶段耗时。应在其他耗时测试结束后运行。
- `integration/session-page-cache.test.ts`：跨项目按需创建页面和预览，同项目切换页面保留局部草稿与画布实例。
- `integration/image-url.test.ts`：大原图的 Blob URL 保持字节不变，重复显示共享资源，最后一个使用者卸载后释放。
- `integration/repository-resource-dedup.test.ts`：单次保存复用相同图像资源，后续保存仍重新检查完整性，失败事务可安全重试。
- `integration/worker-analysis-session.test.ts`：多批次纸样使用同一个真实几何进程，结果与独立请求一致，结束后进程退出；外层计算持有的工作进程可以继续使用。
- `integration/worker-disposal-failure.test.ts`：3 项真实 Rust 工作进程测试，在观察到进程退出后注入清理确认异常，检查重复释放、独立分析和请求取消均传播失败，且不产生未处理的拒绝。

- `launcher.test.ts`：Windows BAT 启动编排，覆盖中文和空格路径、首次安装、参数转发及各阶段失败中止；使用命令记录器，不替代真实几何或桌面验证。
- `integration/worker-session.test.ts`：真实 Rust one-shot/`--stream` 的平面与曲面求解等价、制造分析交替请求、连续错误恢复、并发拒绝、Abort/Dispose、序列化失败、UTF-8 输入/输出限额与真实超时。需要已构建的 `target/release/fpcad-worker.exe`；不使用假进程或假时钟。
- `integration/ui-async-lifecycle.test.ts`：真实 Vue 组件在预览关闭、修订切换、页面卸载后忽略晚返回，旧预览不会清除新任务锁；助手状态轮询不会覆盖新开关状态，卸载后不会继续模型／MCP 请求或导入技能。使用隔离 IPC 适配器，不替代真实桌面验证。
- `integration/localization.test.ts`：语言选择持久化、日语加载／取消／超时提示和用户文本不变。
- `integration/worker-cancellation-lifecycle.test.ts`、`integration/surface-progress-runtime.test.ts`：取消／超时后等待原生 exit／close 或子进程 PID 消失，覆盖晚到子进程、线程终止失败、事件竞态及有界清理失败；使用受控生命周期事件，不替代原生几何验证。
- `integration/native-cancellation-exit.test.ts`：观察真实 Rust 工作进程的 exit 和 PID 存活状态，确认 one-shot／stream 取消完成时进程已经退出；不替换原生工作进程。

- `topology-provenance.test.ts`：精确细分、推断依赖、审阅与锁定、输出门禁、撤销和文件往返。
- `anatomy-inference-provenance.test.ts`：分类元数据变更保留有效推断依赖、既有审阅状态和失效依赖。
- `anatomy-binding-provenance.test.ts`：部位分类保留失效绑定，验证导出门禁、有效依赖更新、撤销和历史快照。
- `cut-candidate-provenance.test.ts`：真实裁切候选的输入指纹、失败事务、撤销后接受、文件往返与旧候选兼容性。旧版已接受快照仍可读取；缺少输入指纹的未接受候选需要重新计算。
- `integration/cut-candidate-dependency-acceptance.test.ts`：重开待确认候选后校验模型、裁片几何和颜色依赖；拒绝时保留项目、历史及请求重放状态。覆盖候选花纹与原花纹不同、空预览、旧算法合法候选。
- `paw-pad-shared-chain.test.ts` 和 `fixtures/paw-pad-shared-chain.json`：真实原图爪垫共享边界的尖折、像素误差、固定端点，以及缩放和旋转后的恢复结果。
- `material-history.test.ts`：历史裁切对材料的依赖、失败事务和历史恢复。
- `fixtures/accepted-cut.ts`：无需原生求解即可构造的平面裁切快照；先按契约规范化，再计算哈希。
- `fixtures/blue-white-material-partition-baseline.json`、`real-blue-white-source-anchors.mjs`：蓝白原图的完整组件像素基线、独立材料定位点与深蓝内部覆盖检查；更新基线须重新核对原图，不能只修改期望数量。

涉及原生计算的测试需要先运行 `npm run build:rust`。桌面测试还需要构建应用；运行方法见根目录 README 和 `../scripts/README.md`。临时数据仅放入 `.local/tests/` 或 `test-results/`，不要使用 `.local/workspace/`。

花纹边缘保真回归：

- `integration/contour-edge-fidelity.test.ts`：低斜率长边、旋转细条、锐角菱形与共享边界。
- `integration/edge-continuity-contract.test.ts`：解析直线接圆弧、圆弧接圆弧和闭合首尾的正向切线连续性、尖角与保护坐标保留、节点预算，以及完整 RGB 提取和孔洞共边保真。
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

- `integration/workflow-geometry.test.ts`：笔迹拟合误差与节点数、三维笔画精简、自由变换固定点与数值幂等、跨视角曲面裁线及对称坐标。
- `integration/workflow-projection.test.ts`：跨部位贴附、同面多个花纹片段的 UV 保留、候选边界与对称曲面裁线持久化，使用真实几何工作进程。
- `integration/workflow-independent-review.test.ts`：裁片内部边消除、不同分段的共享裁线去重、曲面边界节点、局部花纹保留、对称事务及模型参数一致性。
- `integration/current-all-brush.test.ts`、`fixtures/symmetric-brush-exact-input.json`：真实 33 点笔触、左右对称、圆笔与多笔重叠、擦除孔洞、边界误差、节点间距及原子撤销；使用真实工作进程。
- `integration/current-design-cut-regression.test.ts`：解剖元数据、半侧候选与原模型绑定恢复、肩部花纹完整性；含耗时整模求解，需单独报告结果。
- `integration/design-chart-coalescing.test.ts`、`integration/design-chart-independent-review.test.ts`：合并多余裁片时保留材料边界、用户裁线、面覆盖和求解缓存有效性。
- `integration/design-section.test.ts`、`integration/design-section-independent.test.ts`：三角形内部截面、孔洞与共享边、面积覆盖、绑定恢复及失败后输入不变。
- `integration/material-diagonal-quality-independent.test.ts`：材料四边形对角线质量、非凸区域、孔洞与窄底色岛。
- `integration/pattern-preview-independent.test.ts`：候选与已确认裁片的单片显示、选择切换、视图缩放及项目数据不变。
- `integration/source-junction-evidence.test.ts`：浅角三材料交点的独立 RGB 证据，以及第三色边界误认的拒绝。
- `integration/image-junction-model-independent.test.ts`：独立栅格化三色 T 交点在不同模糊和旋转下的定位、错误颜色归属拒绝、近邻双交点与短共享边、透明像素和非有限输入保护；不调用原生裁切。
- `integration/image-junction-bend-independent.test.ts`：连续花纹边跨越三色交点时恢复真实尖角，拒绝圆弧、抛物线和错误颜色归属；检查载线反向、支线换序、透明与无效输入，以及 through 点经完整生产拟合后三种毫米标定下的保留和材料覆盖。
- `integration/image-material-observation-independent.test.ts`：已知调色覆盖率与量化界、病态和错误 palette、透明与裁剪预算，以及真实圆弧／平头负例；检查跨两个交点的短共享边原子修改、未知材料回退和三种毫米标定下的完整材料网络。
- `integration/design-provenance-roundoff.test.ts`、`integration/design-roundoff-independent.test.ts`：材料细分重心坐标的浮点边界、真实越界拒绝、嵌套面积守恒与持久化契约。
- `integration/design-section-budget-independent.test.ts`：33 个材料区域各触发一次真实截面细分，检查后访问区域仍保存面内截点、逐面面积和颜色；仅注入原域求解拒绝，其余几何与制造检查使用生产实现。
- `integration/surface-refiner-reuse-independent.test.ts`：九次独立试算的隔离、共享边与相邻材料、父面面积和坐标、纹理 UV、保存裁线与锁定约束，以及远处退化面的拒绝。
- `integration/design-local-dart-retention-independent.test.ts`：局部省道接受后保留其他裁片的全部顶点，失败试算不泄漏重复顶点；只注入原域求解失败，后续使用真实原生求解。
- `drawing-plane-delta-component.mjs`：斜面转动后的节点拖动保留点击偏移，跨指定部件及被前方独立表面遮挡的移动不生效；使用共用组件宿主，不验证 WebView2 显示。
- `integration/line-visibility-independent.test.ts`、`line-visibility-component.mjs`：用独立射线与真实 Vue 交互检查正交／透视遮挡、候选线透明度，以及可见截面手柄拖动；不替代最终 WebView2 像素检查。
- `legacy-paint-edit-component.mjs`：旧画笔多边形进入节点编辑时生成有界压缩草稿，取消不写入、确认才保存；保留已有曲线、样条和原图轮廓。组件宿主不代替 WebView2 验收。
- `current-legacy-paint-confirm-e2e.mjs`：需要将 `FPCAD_INSPECT_DATA_DIR` 指向 `.local/tests/` 内已接受 168 片结果的隔离基线，再运行 `node scripts/test-desktop.mjs --jobs 1 current-legacy-paint-confirm-e2e`。脚本只读备份该 SQLite 库到新的隔离目录，在隐藏 WebView2 中检查 147 点旧花纹生成 18 点草稿、取消不写入、真实确认与撤销；不重算整模，不加入缺少该基线的默认桌面套件。`legacy-paint-camera.mjs` 是其缩放与平移显示辅助模块，不是独立测试入口。
- `trim-material-preview-component.mjs`：独立密集探针检查同原面多色 trim 的精确范围、选择与失效过滤、颜色开关，以及映射草稿不残留旧裁片色；核对 GPU 输入和 Canvas 备用路径，不替代实际像素验收。
- `legacy-handle-visibility-component.mjs`：运行 `node tests/legacy-handle-visibility-component.mjs "<隔离真实工作流导出的绝对路径>"`，也可用 `FPCAD_REAL_HANDLE_WORKFLOW` 指定文件。该导出须与 `fixtures/legacy-handle-occlusion.json` 记录的项目哈希一致；固定样本只保存独立诊断的 18 个世界坐标节点与相机证据。测试用真实 Vue 交互及独立射线检查可见节点、转动视角、编辑与取消；不读取用户库，不加入缺少真实导出的默认套件。
- `workflow-editing-component.mjs`：自由变换确认与取消、绘制中隐藏节点、松手后生成节点，以及绘制时旋转模型；不替代桌面像素验证。
- `mapping-transform-e2e.mjs`：运行 `node tests/mapping-transform-e2e.mjs`，在隐藏的 WebView2 窗口中检查自由变换手柄与数值同步、取消与确认、左侧控件与右上导航的位置，以及对称涂绘的即时预览、稀疏节点、双侧原子撤销和锁定保护；使用独立项目库，截图和报告默认保存至 `test-results/current-cutting/mapping-*`。
- `cut-workspace-render.mjs`：运行 `node tests/cut-workspace-render.mjs`，在无界面浏览器中检查真实 Vue 裁切工作台的 1280×800 与 1920×1080 布局、顶部按钮、二维辅助预览，以及计算预览和确认保存的分离；使用 API 替身，不验证求解算法。截图和报告保存在 `test-results/cut-workspace-*`。默认使用已安装的 Edge，也可通过 `FPCAD_TEST_BROWSER` 指定本地 Chromium 可执行文件。
- `cut-tools-e2e.mjs` and `fixtures/closed-pen-render-oracle.mjs`: hidden WebView2 acceptance for closed pen triangles and polygons, distinct-node limits, draft history, rejected open/branched/retraced/crossing commands, legacy repair guidance, and exact rendered-to-saved world path coverage. The observer reads real Canvas 2D draw calls; coordinates, screenshots, and restart evidence are written to `test-results/current-task-closed/` by default (`FPCAD_CUT_TOOLS_RESULTS` overrides the directory). The suite also retains half-side manufacturing, local assistant, layout, and persistence checks.
- `integration/surface-free-brush.test.ts`：无选中花纹的新笔刷、圆形与方形尺寸、跨部位与分离投影、失败不写入、撤销重做和文件往返。
- `surface-edit-projection.test.ts`：曲面节点深度、遮挡层次、部位限制与轮廓裁至模型边缘。
- `integration/surface-progress-runtime.test.ts`、`integration/surface-progress-transport.test.ts`：真实阶段协议、限流、取消、迟到事件和订阅清理。
- `surface-inspector-render.mjs`：实际 Vue 检查器渲染，检查侧面补全面板、新建截面环线入口的移除与历史数据编辑入口的保留；不替代桌面鼠标交互。
- `surface-panel-component.mjs`：实际 Vue 组件的圆/方笔刷首次预览、按下拖动保存，以及旋转视角后的曲面轮廓与节点位置、拖动暂存和确认保存。使用自定义渲染器与 DOM/IPC 替身，报告至 `test-results/surface-panel-component.json`，不替代 WebView2 显示验收。

当前模型编辑与原图证据专项：

- `image-contour.test.ts`、`integration/image-contour-independent.test.ts`：独立解析图形及 RGB 采样，覆盖斜直线、圆弧、波浪边、月牙尖端、孔洞、共享边界与低对比度，不以算法自己的输出作为误差真值。
- `integration/contour-independent-acceptance.test.ts`：从默认导入入口检查硬边与抗锯齿斜线、浅色弯曲边界、真实尖角、小孔和颜色归属，并比较独立解析真值。
- `integration/material-step-preservation.test.ts`：保留有明确色阶的浅色花纹和 4×4 小孔，检查渐变阴影与孤立噪点仍被过滤。
- `model-transform.test.ts`、`integration/model-transform-project.test.ts`：对象／部位／顶点变换、裁线曲面对应、花纹依赖、失败事务与撤销。
- `integration/source-drop-locality.test.ts`：真实胳膊落点、遮挡、同部位名的断开网格、缩小后原锚点离开轮廓。
- `integration/design-freehand-allowance.test.ts`：跨三角形的自由裁线、二维与三维面积守恒、0 / 100 mm 缝份及过期候选拒绝。

以下脚本使用实际 Vue SFC、自定义渲染器及受控 DOM／IPC；有些调用真实 Rust。它们验证交互和数据结果，不能代替 WebView2／GPU 显示验收：

```powershell
node tests/model-viewport-component.mjs
node tests/cut-selection-component.mjs
node tests/assembly-preview-component.mjs
node tests/model-manufacturing-controls-component.mjs
node tests/unwrap-lifecycle-component.mjs
node tests/source-region-locality-component.mjs
node tests/surface-scope-component.mjs
node tests/current-brush-component.mjs
node tests/workflow-editing-component.mjs
```

`current-brush-component.mjs` verifies sparse freehand regions, draft undo/redo, real area paint in Cutting, clean saved seam display and cut candidate selection without a Mapping transition. `integration/current-all-brush.test.ts` uses the native worker to check source/model round dabs, oblique two-point capsules, overlapping fills, repeated contained strokes and erased holes. Its boundary oracle samples analytic swept disks independently of the production footprint and fitter, with a 0.5 mm limit. These focused reports are saved in `test-results/current-cutting/`.

`fixtures/symmetric-brush-exact-input.json` preserves an isolated desktop test's project and exact 33-point IPC input. The all-brush suite replays the production paint and symmetry functions, checks both closed boundaries, fewer than 80 editable nodes and no spans below 0.5 mm, and verifies both sides share one undo step with exact redo/archive restoration. Reconstructed camera and rounded-pointer trajectories are separate adversarial cases; they are not represented as the captured IPC input.

`source-region-locality-component.mjs` 还需要 `test-results/current-task/real-cut-project.json` 的真实项目副本与 locality 集成测试输出；不读取或修改用户项目库。`surface-viewport-host.mjs` 是共用测试宿主，不是独立测试入口。新生成的本轮验证结果放在 `test-results/current-task-2/`。

2026-10-18 的历史裁切汇总位于 `test-results/current-cutting/current-verification-summary.json`，保留当时的原始全量、定向复测、失败、跳过及桌面构建范围。它不代表当前版本通过验收。2026-10-24 的完整文件组合验证见 `test-results/responsiveness/vitest-complete-file-wire-summary.json`，桌面与性能状态见 [当前修改记录](../update/2026-10-24-loading-responsiveness.md)。纯诊断脚本与阶段证据保存在忽略目录 `test-results/current-cutting/diagnostics/`；它们不是业务验收通过记录。

`decal-transport.test.ts` checks pose-preserving curved-surface movement and translation after resizing. `integration/dense-garment-dart.test.ts` checks that mesh density does not turn a conical panel into strips; `integration/design-section.test.ts` includes a posed tubular limb. `reported-workflow-e2e.mjs` is an optional local reproduction requiring `test-results/new-report-project-0.json` and `test-results/new-cut-candidate.json`; it backs up the user database read-only and edits only an isolated test copy.

2026-10-23 geometry and manufacturing regressions:

- `integration/decal-coarse-plane-independent.test.ts` and `integration/decal-chart-reach-independent.test.ts`: independent area and hole checks across coarse/dense meshes, curved contour reach, disconnected geometry, resizing and oversized-placement rejection.
- `integration/panel-neck-independent.test.ts`: real native unfolding and coalescing preserve source coverage while separating narrow cloth connections; exact edge subdivision and wider connections retain their expected behavior.
- `integration/garment-structural-sections.test.ts` and `integration/refine-shoulder-provenance.test.ts`: actual DTD/padded structural sections, valid parent coordinates, complete coverage and unchanged source vertices.
- `integration/wrist-section-panel.test.ts` with `fixtures/wrist-section.json`: a measured wrist section must not produce a microscopic third panel.
- `wearer-model-e2e.mjs`, `reported-workflow-e2e.mjs` and `manufacturing-preview-e2e.mjs`: hidden desktop checks for independent model persistence, complete wrapped markings after transformations, default selection and global spacing reflected in actual PDF/SVG output.
- `mapping-selection-state-component.mjs`: narrow projected markings remain movable after numeric resizing at two viewport scales, while handle resizing, draft undo/redo and single-commit confirmation remain available.
- `../apps/desktop/src-tauri/src/json_precision.rs`: the desktop Rust manifest tests repeated JSON round trips without changing contour coordinate bits. This is separate from the geometry worker's Rust suite.

[`real-dual-candidate-replay-e2e.mjs`](real-dual-candidate-replay-e2e.mjs) replays the captured native 49-piece acceptance failure without repeating reference extraction. Set `FPCAD_REAL_DUAL_REPLAY_PROJECT` to its complete isolated project JSON and `FPCAD_REAL_DUAL_REPLAY_SHA256` to the capture manifest hash. The test preserves the actual 9512-face padded mesh and original JPEG resources, recomputes a fresh candidate with the real worker and the captured options, requires the business limit of 10–50 panels with unchanged physical quality and coverage limits, then checks visible acceptance, atomic undo/redo, four original-source attachments, rendered pixels, inverse-edit rejection, SVG/DXF output and restart. The historical count of 49 records the original failure, not a required solver output. It never accepts the historical damaged candidate or constructs substitute geometry. This optional suite requires the captured input and is not part of the default desktop batch; `FPCAD_REAL_DUAL_REPLAY_RESULTS` can select its evidence directory.

2026-10-24 allocation follow-up regressions:

- `integration/surface-validation-topology.test.ts`: unchanged validation under all tetrahedron vertex orders, distinct malformed-topology errors, cut-edge direction and duplicate checks, disconnected closed shells, and exact edge identities at the 200,000-vertex limit.
- `integration/surface-display-lod.test.ts`: full geometry with textures or explicit detail must not construct an unused simplified mesh; simplified faces still resolve their original selected bindings.
- `integration/surface-texture-lifecycle.test.ts`: actual component lifecycle with controlled decoders, pending cancellation, late completion, original texture dimensions and Canvas drawing-state reset. These command-recording tests are complemented by the real browser pixel entry above.
- `integration/repository-resource-dedup.test.ts`: existing assets avoid repeated insertion side effects while every later use still rejects stored-content corruption and failed transactions remain retryable.

`integration/padded-outline-correspondence-independent.test.ts` retains the native 46-panel body's actual 45-triangle trim and 15 original surface faces. It verifies that a positive-area source corner survives the strict 0.000001 mm manufacturing stage, and independently rejects the captured paper outline that erased its 0.000572292 mm tip despite almost unchanged area. `fixtures/padded-manufacturing-spur.json` records the original executable and candidate hashes; it is a regression capture, not a new generated body acceptance result.

`integration/intrinsic-tree-seed-independent.test.ts` replays the exact five-vertex, three-face ill-conditioned strip in `fixtures/intrinsic-tree-three-face.json` through the real native worker. Unseeded solving fails, the intrinsic seed preserves all physical edges and areas in one oriented chart, and a reflected seed is rejected. It also compares identical coarse/dense tilted planes, develops over-64-face cylindrical sheets with one/two holes using actual chord widths, and checks native certification, hole exclusion and inverse mapping. Nonclosing cone/saddle cycles, nonmanifold edges and disconnected topology are rejected. `integration/panel-neck-independent.test.ts` compares equal-shaped 99 mm² and 101 mm² cloth lobes with actual final native flattening, preserving the former as one panel without disabling the narrow-neck rule for the latter. Its captured `fixtures/real-small-leg-material-union.json` also requires the original 40.7215 mm² three-piece leg detail to emerge as one physical piece with complete source coverage, unchanged source coordinates, preserved per-triangle area/edge lengths and the original hard quality limits.

`integration/certified-seed-working-arms-independent.test.ts` retains both exact pre-provenance arm cases in `fixtures/working-arm-three-face.json` and `fixtures/working-arm-six-face.json`. Complete production unfolding must return one piece for original and reordered storage, preserve every physical source face, keep all triangle area/edge errors within 0.000001, and leave inputs unchanged. Actual native LSCM validation plus production union also accepts the captured valid seeds while rejecting mirrored and 1.01×/2× scaled seeds. The 1.01× case deliberately stays inside normal area/edge strain bounds and must still fail the original sewing bound.

`integration/allowance-created-holes-independent.test.ts` distinguishes an allowance-generated cut hole from a lost source hole with an independently prescribed C shape. Its 10 mm mouth/10 mm allowance, surviving 25 mm source hole and collapsed 5 mm source hole run through round/bevel/miter joins and a genuinely nonuniform 8–12 mm edge profile. Four captured paper outlines were independently reproduced as old-worker `holeCollapsed` failures and new-worker valid single outlines; their 299 KB fixture excludes the whole model. A compact 815-face physical domain also goes through complete production unfolding: both zero and 10 mm allowance retain one piece, all source faces and the same seam dimensions, while the latter creates one cut hole without a manufacturing repair split. `fixtures/allowance-created-hole-analytic.json` is shared by the independent manufacturing export tests.

2026-10-25 新增独立功能测试：

- `integration/contour-independent-acceptance.test.ts`：解析直线和曲线经真实 JPEG 90/75 压缩后，检查双向位置误差、接点切线、材料边界和孔；保留原验收阈值。
- `integration/character-functional-separation.test.ts`：直接核对原 JPEG 像素和保存矢量，检查正背尾巴与大腿的八个黄色／青色取点。
- `integration/visible-body-placement-matrix-independent.test.ts`：真实 DTD、填充和兽装模型上的 40 处手工贴附，核对最近可见锚点、同连通曲面、完整源轮廓与孔、预览／保存、归档和撤销重做；不替代原生拖卡或自动贴附矩阵。
- `integration/prepared-source-identity-independent.test.ts`、`integration/trial-seam-rejoin-independent.test.ts`：保留导入模型原有独立顶点缝，检查临时缝重连、锁定缝、候选输入不变及恢复绑定后的往返映射。
- `integration/protected-trial-union-independent.test.ts`：同一网格中，局部合并拒绝经端点替换间接闭合锁定边，同时保留导入重合缝，并让无关临时缝经过真实原生验证。
- `integration/curved-holes-independent.test.ts`：带一／两孔的可展圆柱面，检查原生孔报告、裁片及绑定、毫米尺寸、映射、接受／撤销、归档和 SVG／DXF／PDF 输出。
- `integration/simplified-hole-adjustment-independent.test.ts`：八站孔简化为四角后，编辑外边界仍固定全部真实孔边站点；省略的外边界中点跟随所在边的位移。
- `integration/manufacturing-section-independent.test.ts`：围绕实际制造阻碍细分曲面，检查细孔处理、来源重心坐标、材料域和失败后的输入完整性。
- `integration/garment-tessellation-independent.test.ts` 与 `fixtures/coplanar-garment-shell.mjs`：同一连通七部位衣壳只做共面四分细化，比较物理裁线、裁片数量、颜色面积、手工缝和覆盖；不替代真实 DTD／填充模型外形验收。
- `integration/wearer-cross-section-independent.test.ts`：从实际三角面独立求固定高度截面，测量 DTD／填充模型周长、对称性与填充变化；测试索引不代表外形已通过视觉验收。
- `integration/allowance-bay-output-independent.test.ts`：缝份新孔与真实源孔分别进入排版、SVG、DXF、HTML 和实际 PDF 刀线；真实源孔消失时拒绝出图。
- `integration/scoped-recovery-visibility-independent.test.ts`：目标面范围只限制花纹落在哪些面上，范围外的近表面仍参与遮挡，共面重叠仍拒绝；实时预览和真实原生保存都不能显示被挡住的材料。
- `integration/automatic-local-placement-independent.test.ts`：新建自动小色块可在同一目标部位内提出有限平移，保留源轮廓、曲线、孔、缩放与未审阅状态；手工位置、已有花纹、锁定、远距、大块、隐藏面及真实歧义均不自动恢复。
- `integration/terminal-paw-adjacency-independent.test.ts`、`integration/terminal-paw-contact-independent.test.ts`：两枚独立爪尖已支持手掌后，额外外端贴掌黑块才可归爪；保留紧邻头部、近手腕暗块、亮色、大块、仅包围盒相邻和重复像素记录的反例。
- `integration/fresh-jpeg-placement-independent.test.ts`：重新解码原 JPEG，以原像素足迹及颜色找到四个历史问题源，检查内腿小块侧别、背身小块有限平移和真实第三爪归属。复用已记录的填充模型；缺少爪部的模型仍须报告 `MODEL_PART_MISSING`，不能改归腿部。
- `integration/project-locked-trial-rejoin-independent.test.ts`：走实际准备、展开和恢复绑定流程，保留原模型锁缝及细分子边，让无关临时缝重连；工作模型只要有锁边仍禁止重连。检查间接端点焊接、全部来源覆盖、实际制造和逆映射。
- `integration/repair-material-merge-independent.test.ts`：修补分组可跨不同临时标签合并，但必须保留原材料身份、导入缝和锁边；真实缝份孔失败时拒绝合并，网格和输入报告保持原样。
- `integration/partial-chart-dart-independent.test.ts`：真实曲面完整合缝不满足应变要求时，检验局部合缝保留省道、来源和物理站点；通过实际工作进程、制造和独立严格审计，同时覆盖材料、锁边和失败状态。
- `integration/seamed-predeformed-seed-independent.test.ts`：缝合展开可修复预变形初值，仍守住原有面积、边长、重叠和缝长门槛；有效初值的物理距离保持不变。
- `integration/near-edge-support-classification-independent.test.ts`：独立来源边识别区分数值贴边与真实内边，保留越界、缺料和缝长畸变反例；不放宽几何或缝合验收阈值。
- `integration/wearer-padding.test.ts`：新填充衣身的领口、双袖口和双脚踝共五个物理开口，下腿筒连续且不带头、手、足；真实旧三开口压缩快照仍经契约、归档和数据库重开保留原几何。
- `integration/model-generation-modes-ui.test.ts`：填充模式隐藏足长字段时，修复无效隐藏草稿并允许生成；合法足长和其他人体尺寸在填充、DTD、兽装模式间保留。
- `native-placement-position-matrix-e2e.mjs`：原始库卡通过实际 pointer 位置拖放，检查最近可见目标、移动、撤销重做和保存重开；自动贴附另分组。当前执行状态以验收记录和对应构建报告为准，准备完成不算通过。
- `simple-mode-persistence-e2e.mjs`：材料、接缝、排料页逐一返回简单预览，再检查保存重载、项目切换、窄窗、选择及实际 PDF／SVG 输出；使用两张手工矩形，不代表默认模型裁切通过。
- `native-response-observer.mjs`：供原生流程读取真实 Tauri 网络回复，不替换应用 API、不重发写命令；不是独立测试入口。
- `integration/closed-trim-dart.test.ts`：真实用户锁缝在直接焊接和绑定恢复后，保留双侧边身份、二度简单边界与连续顶点扇；覆盖重心坐标细分、正反多段及单侧不等分站点，无关未锁省道仍可消除。
- `integration/multi-material-structural-start.test.ts`：双色袖身保留原三材料域；单色五开口衣身按实际上下身、左右袖八组件及完整来源面积检查，脚踝不再产生旧足部条片。
- `integration/planar-seam-completion.test.ts`、`integration/review-transient-errors.test.ts`：平面锁线及孔保留完整材料和简单制造边界；真实源面邻接参与重连，资源错误不能留下半完成网格。
- `integration/native-contour-contact-independent.test.ts` 与 `fixtures/arm-short-corner-native23.json`：原生求解的三份实际 23 点轮廓逐一以零／10 mm 缝份制造，保留微短角、面积与输入；默认使用正式工作进程，隔离试验可通过 `FPCAD_CONTACT_WORKER` 指定。
- `fixtures/partial-cone-self-contact.json`：保留旧候选中真实非相邻自触的原坐标、来源摘要和精确接触位置；局部省道测试单独验证制造拒绝，不要求新搜索继续生成坏轮廓。
- `integration/eye-detail-jpeg-independent.test.ts`、`integration/detail-fabrication-state-independent.test.ts`、`integration/detail-fabrication-cut-independent.test.ts`、`integration/detail-fabrication-edit-independent.test.ts`：保留原图瞳孔／虹膜／高光并指定印绘细节，检查旧指纹兼容、修改角色、真实原生裁切底布、孔、映射／SVG／DXF、锁／失效状态、撤销和重开；不替代原生界面和整件衣壳流程。
- `fixtures/detail-fabrication.ts`、`fixtures/original-jpeg-before-detail.sources.json.gz` 与相邻 provenance：制作方式功能夹具和真实旧 101 源压缩快照。
- `../crates/geometry-core/src/contour_contact_independent_tests.rs`：核验相触／分离／孔拓扑、平移缩放、真实短角与 10 mm 缝份；Rust 工作区测试执行。已撤回的预条件求解实验及其矩阵测试源码保存在 `test-results/2026-10-25-pattern-quality/reverted-pcg-experiment/`，不列入当前测试数。

整张设定图新增覆盖：

- `integration/reference-sheet-independent.test.ts`：单图导入、旧图兼容、标定、保存及来源指纹。
- `integration/reference-sheet-figures-independent.test.ts`：真实原图与人物交换布局的逐像素归属、独立部位分组、眼部细节、连续白色区域的身体与双腿上下文，以及朝向不明时保留人工处理入口。
- `integration/reference-sheet-blue-white-figures-independent.test.ts`：第二张蓝白原图的完整人物识别、交换位置后的逐像素归属、独立眼部窗口和深浅蓝色区域；检查白色毛料断开时仍能识别完整人物。
- `integration/large-geometry-storage-independent.test.ts`：大几何字段与旧内联格式的读取、归档、撤销重做、恢复、请求重放、共享资源回收及失败回滚；失效依赖和未审阅状态必须保持。
- `integration/arm-small-union-numerical-independent.test.ts`：用实际 139 面袖部输入复现旧求解失败，检查新结果的完整材料、边界、原生制造和接缝精度。
- `integration/automatic-placement-batch-independent.test.ts`、`integration/automatic-placement-transaction-independent.test.ts`：整批工作线程、取消、失败无半写入、一次撤销及待审阅状态。
- `reference-sheet-desktop-e2e.mjs`：真实隐藏桌面中的原图导入、选区编辑、保存重开、衣身生成、细节拖放变换、自动贴附与审阅。
- `reference-sheet-cut-e2e.mjs`：使用前一流程留下的原隔离库计算真实裁片，保持生产时限，不导入或复用候选。
- `reference-sheet-manufacturing-e2e.mjs`：延续同一真实候选，检查接受、纸样预览、实际尺寸导出、撤销重做及进程重启。

当前通过范围与未完成验收见 [功能验收记录](reported-functional-acceptance-contract.md)。2026-10-26 的完整功能运行覆盖 366 个文件、2814 项检查，全部通过且没有跳过，结果见本地 `test-results/2026-10-26-reference-sheet/full-functional/final-compatible-all.json`。随后发现的腿侧识别问题另有原图、人物交换位置及受影响文件的完整复测。历史中断、失败与对应复测记录均保留；桌面整链结果单独记录，不计入上述数量。

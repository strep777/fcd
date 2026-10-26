# 原图识别与共享轮廓恢复

核对日期：2026-10-26。当前实现从原始分辨率恢复有来源的花纹区域，不以美化曲线为目标。本轮未重跑图像测试；真实 JPEG 的视觉和制作准确性仍需单独验收。

## 输入与语义

原图资源保存完整图像、尺寸、校验信息和预览资源；交互可用代理图，几何来源仍指向原图。整张设定图入口用 [sheet-figures.ts](../../packages/reference/sheet-figures.ts) 建立人物上下文，而非要求用户先裁成正背两张。

当前整图路线先在代理图寻找人物间隔，再回到原像素确认空白分隔，识别窗口仍返回完整原图坐标。背景估计使用边缘主色的中位数，旧单视图入口保留均值估计。连续同色来源可保留多个有证据支持的身体／肢体贴附上下文；这些分类不是新的缝制边界。腿部与尾部归属仍是规则判断，需要人工复核。

[illustrationRegions](../../packages/reference/illustration.ts) 和颜色聚类路线分别处理插画色区与其他选区输入。[background.ts](../../packages/reference/background.ts) 识别边界连通背景；[pigment-shadows.ts](../../packages/reference/pigment-shadows.ts) 等模块结合颜色和邻域证据区分材料与明暗。平稳硬边浅色块可以保留，渐变和阴影不应一律成为新毛料。

[eye-details.ts](../../packages/reference/eye-details.ts) 识别的眼部细节可标为 `detail`；[paired-palette.ts](../../packages/reference/paired-palette.ts) 只在每个视图同色族具有唯一且相近的颜色证据时协调色板。多个同色族材料保持独立；新自动提取的色板规则不覆盖手工改色。

部位、左右、人物实例和材料语义均需要核对。遮挡区域没有唯一恢复答案，邻接补全不能写成原图事实。当前自动推断接口与页面可达性见[功能目录](../guides/feature-catalog.md)。

## 共享轮廓网络

对相邻材料分别平滑会留下细缝或重叠。[recoverSharedContours](../../packages/reference/shared-contour.ts) 构造共享网络：同一条链只拟合一次，另一材料反向使用。连接点、外边界和孔洞均属于网络，不能各自移动。

拟合在规范化的原像素坐标系中执行，再变换回毫米。平移、旋转和标定比例不应改变材料相邻关系及像素误差预算。同一原图改变物理标定，不应获得另一种拓扑。

## 直线、尖角与曲线

[recover-contour.ts](../../packages/reference/recover-contour.ts) 识别数字直线段，从像素台阶恢复有证据支持的直边；每级台阶不都是设计拐角。直线解释失败时才考虑曲线，拟合受边界证据约束，不额外施加视觉平滑、统一切线或圆角目标。

直线识别带宽最多 1.8 个原生像素。这不是最终误差：共享轮廓验证使用不超过 1.05 个原生像素的双向边界包络，并计入采样与曲线扁平化误差。旧 API 的 0.8 像素调用参数有兼容含义，不能直接写成最终几何精度。

[imageBoundaryFit](../../packages/reference/image-contour.ts) 从原 RGB 过渡采样，估计局部法向和材料平台间边缘。低对比、多种可能边缘或预算不足时不捏造唯一边界。测得的直线、独立三次曲线和尖角窗口都要通过网络检查。

## 约束与适用范围

| 约束 | 当前规则 | 代码依据 |
| --- | --- | --- |
| 拓扑 | 保持方向、孔洞数和包含关系，禁止自交和环间非法接触 | [contour-topology.ts](../../packages/reference/contour-topology.ts) 的 `safeContour` |
| 面积 | 默认每环不超过原面积的 3%，允许一个像素面积的下限 | `safeContour` 逐环检查 |
| 距离 | 共享恢复链双向距离最终包络为 1.05 原生像素 | [shared-contour.ts](../../packages/reference/shared-contour.ts) 验证调用 |
| 小孔 | 小于 16 原生像素平方的孔保持精确路径 | [recover-contour.ts](../../packages/reference/recover-contour.ts) |
| 共边 | 两个所有者使用同一链和同一连接点 | `recoverSharedContours` |
| 资源 | 节点、扁平化、采样、相交和提案均有上限，超限回退或失败 | `contour-topology`、`recover-contour`、`image-tip-*` |

基础 `safeContour` 在其他调用方有自己的默认距离参数。上表 1.05 像素只指共享恢复路线，不能外推为所有编辑接口的容差；手工编辑遵循各自毫米约束。

小而封闭、证据充分的亮色岛可从像素中心半覆盖等值线提案，拟合残差不超过 0.15 原生像素。只有完整保留该来源支持闭链时，才允许半像素乘周长的面积预算，回退后撤销例外。[image-compact-contour.ts](../../packages/reference/image-compact-contour.ts)

尖角或截断直边可凭局部源图支持恢复模糊直边交点。认证窗口只替换对应基线，其他部分仍使用原边界；不能借局部提案放松整条链。[image-tip-source-tube.ts](../../packages/reference/image-tip-source-tube.ts) 把扁平化和未采样区间计入距离上限；[image-tip-junctions.ts](../../packages/reference/image-tip-junctions.ts) 在所有邻接分支证据一致时才移动共享端点。窄直条厚度调整也受像素、面积和拓扑共同约束。

## 回退和编辑

网络验证失败时尝试有限的单链撤回，要求修好失败区域且不破坏之前有效的邻区；仍失败则退回相关像素链。撤回图像证据后不能继续享有面积或基线例外。处理顺序不应让相邻材料漏检。

用户源区修改通过 [library-region-edit.ts](../../apps/desktop/main/library-region-edit.ts) 更新源区和相关贴附状态。手工贴附、锁定对象、失效来源和拓扑冲突需要明确处理；不能因为源区更平滑就自动批准旧映射。草稿、保存事务和撤销也属于该流程的要求。

## 参考算法与实现区别

数字直线和多边形重建背景可读 [Potrace 论文](https://www.mathstat.dal.ca/~selinger/potrace/potrace.pdf)与 [DGtal 数字直线识别](https://www.dgtal.org/doc/1.4/moduleArithDSSReco.html)。当前实现是有界数值识别和源图拟合，不是完整移植这两个算法，也没有采用无条件审美平滑阶段。

旧文档中的单次修复和验收记录不再混入现行规范。这里保留输入、误差、来源和回退契约，局部阈值以链接源码为准，实际测试结果保存到 `test-results/`。

## 如何验收

用解析直线、圆、曲带、尖角、窄条、孔洞和接触色区检查已知边界，再用固定真实设定图检查部位、细节、阴影、共边和来源身份。比较标定旋转／缩放前后结果，并分别检查提案与回退结果，防止“没有报错”掩盖没有恢复目标形状。

JPEG 模糊和阴影可能使材料真实边界不唯一。像素梯度峰值只作诊断，不能代替制作者确认。最终同时检查原图忠实度、可编辑性和后续材料分区完整性，见[验收矩阵](../planning/acceptance-matrix.md)。

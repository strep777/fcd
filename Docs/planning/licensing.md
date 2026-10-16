# 授权与能力管理规划

> 状态：待实现的设计草案，未代表已发布能力或验收通过。
> 整理日期：2026-10-12；保留早期规划的技术方案，具体范围和指标需实施前复核。

**当前状态：** 当前未实现商业授权、订阅、离线签名令牌或收费能力门禁。套餐、配额和离线期限均为候选设计，不能视为现行产品限制。

[返回后续规划](roadmap.md) · [文档导航](../README.md)

## 能力模型

User→Organization→Plan→Entitlement→FeatureGate。Feature 注册表包含 ID、引入版本、能力说明、依赖和离线策略。Renderer 的禁用按钮仅为体验，Main 在命令/结果接受/导出边界执行真实检查。Rust 不判断 vip，但独立 SDK 商业分发需另行设计授权边界。

基础离线能力固定为项目打开/保存、基础2D、基础参数身体、3D几何预览、传统花纹处理、基础UV、基础PDF/SVG；高级自动优化/排料/DXF/AI按令牌控制。原文套餐示例中 SVG/预览收费与离线原则冲突，采用前述基础离线下限，见 ADR-005，定价仍待商业负责人决策。

## 令牌格式与校验

签名载荷包含 licenseId、subject、organizationId?、features、issuedAt、notBefore、expiresAt、offlineUntil、deviceBinding?、keyId、tokenVersion、nonce。采用固定规范 JSON UTF-8 字节做 Ed25519 签名，签名与 payload 分离。明确拒绝未知 keyId/算法、重复 JSON key 和歧义数值；公钥内置或由受信链轮换，私钥仅签发服务持有。

校验顺序：结构→keyId→签名→notBefore/expiry/offlineUntil→绑定（若配置）→feature。签名数据不能依赖客户端重排不一致的普通 JSON。令牌放 OS 安全存储；日志只写脱敏 licenseId 摘要，不写 token。

## 状态机

Unactivated→ActiveOnline→ActiveOffline→Expired / Revoked。网络错误不是 revoked；有效离线期限内照常使用已授权能力。超过有效期限停止新高级操作，已存在数据可读可保存、基础输出继续。在线确认 revoke 后立即禁止新高级任务；已运行任务可以完成为候选，但接受/高级导出重新校验。

记录最后可信服务器时间与单调时钟检查明显时钟回拨；不能声称纯离线客户端完全防篡改。异常仅限制新高级操作并给出修复方法，不锁死项目。离线期限候选30天，具体套餐到 I9 冻结；企业完全离线签发流程需手工请求/响应或局域网服务，服务部署属 Future。

## 配额与故障

能力开关和配额分离。基础本地编辑不按计费次数扣减；涉及在线配额需幂等 reserve/commit/release，只有任务成功交付才提交消耗，重试不重复扣减。离线计费配额策略未定前不发布此类收费功能。

测试签名篡改、过期、未来签发、未知密钥、断网、回拨、撤销、重复激活、设备更换和 Renderer 绕过（TC-027～029）。

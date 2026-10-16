# 账号与可选云服务规划

> 状态：待实现的设计草案，未代表已发布能力或验收通过。
> 整理日期：2026-10-12；保留早期规划的技术方案，具体范围和指标需实施前复核。

**当前状态：** 当前没有账号、计费、授权服务或项目云同步实现。本地 CAD 不依赖这些服务；服务目标和示例接口尚未经过部署验证。

[返回后续规划](roadmap.md) · [文档导航](../README.md)

## 发布范围

I9 必需：账号、授权签发/刷新/吊销、订阅状态、更新清单和模型清单服务。cloud-project、团队、SSO、企业私有服务是 Future，接口预留不代表实现。api.fpcad.com 是母文档示例域名，不声称已注册或可用。

## REST 约定

统一 /api/v1，JSON UTF-8，错误 {code,message,requestId,retryable}，写入接口支持 Idempotency-Key。401 身份无效、403 无能力、409 冲突、422 参数错误、429 限流带 Retry-After、5xx 服务故障。重试限幂等操作，指数退避且有上限；客户端不得因商业服务失败阻断本地工程打开。

|接口|请求关键字段|响应关键字段|鉴权/行为|
|---|---|---|---|
|POST /auth/session|外部认证授权码+PKCE verifier|session/access expiry|采用成熟身份提供方，首版不自造密码算法|
|POST /license/activate|activationCode,devicePublicId,clientVersion|signedToken,serverTime|授权码交换；幂等|
|POST /license/refresh|licenseId,currentTokenDigest|signedToken,serverTime|有效会话；不得上传项目|
|POST /license/revoke|licenseId,reason|revokedAt|本人或组织管理员；审计|
|GET /license/me|无|licenseSummary|用户会话|
|GET /features|clientVersion|catalogVersion,features|公开目录不等于实际授权|
|GET /updates|platform,arch,channel,version|signedManifest|按平台签名与渐进发布|
|GET /models|runtime,platform|compatibleManifests|仅元数据；下载再校验|
|POST /billing/webhook|供应商签名事件|receiptId|验证签名/时间窗/eventId去重|

账号登出删除会话凭据，不删除项目。计费成功只能经服务端可信支付事件更新授权，不能相信客户端“支付成功”字段。真实支付供应商与税务流程为商业待决，不填入假接口密钥。

## 服务数据与运维

accounts、organizations、memberships、plans、subscriptions、licenses、activation_devices、revocations、webhook_events、audit_events 为服务端领域。支付卡数据由支付供应商处理，产品只存必要供应商引用。授权签名私钥使用受控密钥服务，管理员操作留审计且日志不存原 token。

候选服务目标：月可用性99.5%、授权响应p95≤2s、备份RPO≤24h/RTO≤4h；I9 压测与恢复演练后才能承诺。离线令牌缓解短时故障，不代替服务器备份。监控签发失败率、更新失败率、队列延迟及 webhook 重复率。

## 兼容和未来同步

客户端声明能力和 protocol/API 范围，至少覆盖最近两个服务端 minor；不得仅比较版本字符串就忽略字段兼容。新增字段向后兼容、删改字段升 major；弃用提前两个 minor 通告。

Future 云项目上传必须用户明确开启并展示资源范围。使用 revision/ETag 冲突检测和分支副本，禁止最后写入静默覆盖；离线更改不自动合并几何。私有部署可考虑 Docker Compose，但依赖与备份由独立版本设计和评审后纳入范围。

# 第三方插件与公共 SDK 规划

> 状态：待实现的设计草案，未代表已发布能力或验收通过。
> 整理日期：2026-10-12；保留早期规划的技术方案，具体范围和指标需实施前复核。

**当前状态：** 内置模块注册已在 packages/modules/index.ts 实现；第三方插件安装、隔离宿主、公共 SDK 和插件商店尚未落地。

[返回后续规划](roadmap.md) · [文档导航](../README.md)

## 分阶段边界

1.0 交付可信内置模块注册，不开放任意第三方可执行插件安装。公共 SDK 和插件商店为 Future。母文档要求的模块化从 I0 建立，第三方沙箱不能仅依靠 TypeScript 类型或约定实现。

FeatureModule={id,version,capabilities,initialize(ctx),dispose()}。依赖由 dependsOn 显式声明，启动拓扑排序，循环依赖拒绝；一个可选模块失败不得使 project/basic CAD 不可用。dispose 必须释放订阅、worker和临时资源。

## 插件清单和权限设计

候选 PluginManifest={id,version,minAppVersion,maxApiMajor,capabilities,permissions,entry,sha256,signature,license}。permissions 区分 project.read、project.command、file.userSelected、network.allowlist；默认无权限。声明权限不等于自动授予，宿主负责授权和命令校验。

第三方插件未来放隔离进程，不可读取主进程内存、账号 token 或任意文件系统。插件不存在访问客户端 License 私钥的合理需求，因为客户端根本不保存签发私钥。宿主提供不可变快照和受控 Command API，不给数据库连接。

## 版本和失败

能力发现替代硬编码版本分支；不兼容 API major 拒绝加载。超时/崩溃终止插件进程，回滚未提交事务，保存项目不受影响。插件卸载只移除程序；其命名空间元数据按未知扩展保存，不能删除用户纸样。

## 扩展验收

I0 验证内置模块注册、顺序、重复 ID、循环依赖、失败隔离。Future SDK 必须额外通过越权文件/网络访问、恶意消息、CPU/内存耗尽和版本迁移测试；未通过不开放第三方插件。TC-033 和 TC-047 跟踪。

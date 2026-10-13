# Git 分支与提交规范

## 1. 适用范围

项目采用每人独立仓库、通过 PR 协作的方式。已有适用分支可直接继续开发，不要求每次任务都另建分支。
创建或命名工作分支时，使用 Git 类型前缀区分用途，不再要求日期或提交人。

## 2. 命名格式

业务开发分支统一使用以下命名格式：

```text
<type>/<简短描述>
```

例如：

```text
feat/cos-text-audit
fix/refund-callback-race
```

## 3. 字段约定

- `type`：新增功能使用 `feat`，缺陷修复使用 `fix`，重构、性能优化、文档、测试、构建、持续集成或工程维护分别使用
  `refactor`、`perf`、`docs`、`test`、`build`、`ci`、`chore`。
- `简短描述`：使用小写英文 `kebab-case`，简明表达改动内容。

## 4. 提交标题

所有提交标题都必须带英文小写类型前缀，并使用简体中文概述：

```text
<type>: <简体中文概述>
<type>(<scope>): <简体中文概述>
```

作用域可选，类型前缀不可省略，冒号后必须有一个空格。类型根据本次提交内容选择，沿用上述类型，并允许 `revert` 表示回退提交。缺陷修复使用 `fix:` 或 `fix(scope):`；历史提交未使用前缀不构成例外。

例如：

```text
fix: 修复裁切候选接受时缺少输入依赖校验的问题
fix(surface): 保留已失效的裁片绑定
docs: 明确提交标题的必选类型前缀
```

完整提交信息要求见 [.github/git-commit-instructions.md](.github/git-commit-instructions.md)。

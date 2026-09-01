# Ping Class 开发约定

本文件适用于整个仓库。子目录若有更具体的 `AGENTS.md`，同时遵循子目录规则。若根目录存在已忽略的 `AGENTS.local.md`，先读取本文件，再读取本地补充；本地补充只能提供路径和环境信息，不得削弱本文件的安全、公开发行或验证要求。

## 项目定位

Ping Class 是面向 WorkBuddy 资料库 Page 的 TypeScript 教学工作台。源码由 Vite 组织，开发环境安装与线上 `window.__SMART_PAGE__.database` 形态一致的 Mock，生产环境输出可按用户数据库映射渲染的单文件 HTML 模板。

当前已实现课表管理和班级管理；课程管理、题库管理与教学资源仍是可继续开发的模块。当前页面行为只是版本现状，不是对月视图、多教师、临时调课、新页面或新资料表的永久限制。

## 事实来源与优先级

1. 当前仓库中的源码、测试和 `workbuddy/app-manifest.json`；
2. 当前安装环境的 WorkBuddy 官方 skill-library 契约；路径通过 `WORKBUDDY_SKILL_LIBRARY` 指定，或由验证脚本按 manifest 中已测试版本从当前用户主目录发现；
3. `AGENTS.local.md` 中声明的本地产品参考页面或数据快照，仅用于比对，不得直接修改或提交；
4. 无法获得官方契约或本地参考时，必须明确说明无法验证，不得猜测兼容性。

WorkBuddy skill-library 版本变化时，先比较 Database SDK、HTML 导入、数据页流程、lint 和解析契约，再更新 manifest 的已测试版本与验证代码。

## 数据库绑定模型

- `workbuddy/app-manifest.json` 是应用版本、数据库 binding、canonical schema、seed policy 和 migration 的唯一公开声明源。
- `databaseBindings` 是可扩展集合，不得在安装器、构建脚本、状态文档或说明文字中假设固定数量。
- 当前业务使用 `classes`、`students`、`lessonSlots` 和 `weeklyTimetable` 等 alias；它们是当前功能依赖，不是封闭清单。
- 源码中的 `databaseId` 必须直接使用对应 manifest placeholder 字符串字面量。目标用户安装时再把所有 placeholder 渲染为该用户的实际 databaseId，确保官方解析器可识别。
- `workbuddy.config.json` 只保存公共构建路径，不保存 databaseId。
- 维护者个人映射只写入已忽略的 `workbuddy.local.json`。不得把真实 databaseId、真实 schema 快照或用户业务数据提交到公共仓库。
- 本地 Mock 文件按 alias 命名，必须是少量、明确标注的合成演示数据；不得使用来源不明的姓名、学号、备注或线上记录快照。

新增资料表时，在 manifest 增加 binding，并同步所需业务代码和 Mock。已有安装升级到新增资料表时，还必须提供连续的 `createDatabase` migration。新增一张表不会自动生成对应界面功能；UI、交互、数据访问和错误处理仍需实现与验证。

## 代码与构建约束

- 业务代码只能依赖官方 `window.__SMART_PAGE__.database`，不要增加第二套线上访问门面。
- SDK 调用中的 placeholder / 最终 databaseId 保持字符串字面量，确保 WorkBuddy `parse_html.py` 能识别。
- 本地 Mock 只能在 `import.meta.env.DEV` 下安装；生产模板不得包含 Mock 实现、schema 或 seed。
- Database 返回值使用安全 DOM API 渲染，不得直接拼接进 `innerHTML`。
- 查询必须完整处理 `hasMore` 和 `nextCursor`。
- 数据库展示值遵守 `data-sp-bindable="database"` 与 `data-sp-database-id` 标注契约。
- 最终模板与目标用户渲染产物均为单文件 HTML；业务脚本必须位于 `<body>`，不得依赖外部 JS/CSS 或未托管的第三方图片。
- 不直接编辑 `dist/` 或 `release/`。它们都是已忽略的生成物。
- 新功能应保持模块边界清晰；不要因为当前导航或数据模型而禁止未来功能扩展。

## 公共与本地文件边界

必须提交：源码、公共配置、manifest、迁移、验证脚本、合成 Mock、公共文档和工作流。

必须忽略：

- `workbuddy.local.json`：个人 databaseId 映射；
- `AGENTS.local.md`：个人参考路径；
- `.private/`：公开前备份或其它本机私有资料；
- `dist/`、`release/`、依赖、缓存、IDE 配置和日志。

仓库公开检查必须阻止个人绝对路径、凭证、维护者本地 databaseId、写死 binding 数量的措辞及非合成学生数据进入公共文件。

## 验证命令

安装依赖与本地开发：

```bash
npm install
npm run dev
```

便携构建、模板验证、数据库数量矩阵与公开仓库检查：

```bash
npm run build
```

安装了受支持 WorkBuddy skill-library 时强制运行官方 SDK lint 和 HTML 解析：

```bash
npm run verify:workbuddy:official
```

生成公共 Agent 发行资产：

```bash
npm run package:agent
```

生成维护者个人可导入 ZIP：

```bash
npm run setup:local  # 仅首次；生成已忽略的映射模板
npm run package:workbuddy
```

个人打包必须读取 `workbuddy.local.json`，并通过实际 databaseId 的官方 lint 与解析验证。公共模板不得读取该文件。

## 安装与发布规则

- 公共安装入口是 `workbuddy/AGENT_INSTALL.md`；它必须遍历 manifest 当前声明的全部 binding。
- 安装状态中的数据库映射动态按 alias 保存，不得写死 alias 或数量。
- 页面更新复用原 `nodeBlockId`，数据库只执行协议允许的声明式迁移，不覆盖用户业务记录。
- `package.json` 与 app manifest 的 SemVer 必须一致，发布 tag 为对应的 `vX.Y.Z`。
- schemaVersion 增加时必须永久保留从旧版本到新版本的连续 migration 边。
- 自动迁移只允许新增字段、仅改名、追加 select 选项、空表 seed 和新增逻辑表。破坏性操作需要目标用户本轮明确确认。
- 已公开发布的 tag 与资产不替换；修正通过新的补丁版本发布。

## Git 提交规则

每完成一个完整功能都必须提交，无论大小。用户可见功能、修复、重构、文档规则、构建或验证调整都属于完整功能。

提交顺序：

1. 保持单一功能边界，不混入无关变更。
2. 每个新文件必须完成“提交、忽略、删除”三选一；不得长期留在未跟踪状态。
3. 凭证、密钥、个人路径、databaseId 或真实用户数据绝不提交；发现后立即停止并检查暂存区及历史。
4. 执行 `npm run build`；适用时再执行官方验证和相应打包命令。
5. 执行 `git status --short`、`git diff` 与公开仓库检查，确认生成物和本地文件均未暂存。
6. 使用 Conventional Commits：`feat:`、`fix:`、`refactor:`、`docs:`、`test:`、`build:` 或 `chore:`。
7. 向用户交付时说明验证结果和提交短哈希。

除非用户明确授权，不修改既有公开历史、不删除 tag、不强制推送，也不顺带提交其它未完成改动。

# Ping Class

Ping Class 是运行在 WorkBuddy 资料库 Page 中的 TypeScript 教学工作台。本地由 Vite 和 Database SDK Mock 支持开发，公开发行版由目标用户自己的 WorkBuddy Agent 创建或复用资料表、注入实际 databaseId，再导入为单文件页面。

当前版本包含：

- 课表管理：固定周视图、日期详情、节次设置以及排课新增、编辑和删除；
- 班级管理：班级与学生查询、筛选、搜索以及新增班级；新增班级的年级选项来自独立配置表，并支持隐藏、排序和自定义；
- 课程管理、题库管理和教学资源的后续功能入口。

当前实现不是功能上限。新增模块可以增加页面、交互、数据库 binding 和连续迁移；发布工具与安装协议不会假设数据库数量。

## 数据库模型

公开数据库声明统一位于 [`workbuddy/app-manifest.json`](./workbuddy/app-manifest.json)。当前业务 alias 包括：

| Alias | 用途 |
| --- | --- |
| `classes` | 班级基础信息 |
| `grades` | 年级名称、排序和新增班级时是否展示 |
| `students` | 学生名册 |
| `lessonSlots` | 节次名称与时间配置 |
| `weeklyTimetable` | 每周固定排课 |

这是当前 manifest 的内容，不是固定清单。源码只保存 alias 对应的 placeholder；用户实际 databaseId 不进入 Git。

## 本地开发

```bash
npm install
npm run dev
```

开发环境从 manifest 动态生成 Mock schema，并读取 `public/mock/data/<alias>.json` 中少量、明确标注的合成演示数据。浏览器修改写入本地 `localStorage`，不会连接或写入线上资料库。

## 构建与验证

```bash
npm run build
```

该命令执行：

- TypeScript 类型检查；
- Vite 单文件模板构建；
- placeholder 与 manifest 全量一致性验证；
- 目标用户映射的离线渲染测试；
- 1、4、6 个数据库 binding 的数量矩阵；
- 个人路径、凭证、本地 databaseId 和 Mock 隐私检查；
- 当前机器存在受支持 WorkBuddy skill-library 时，执行官方 Database SDK lint 与 HTML 解析。

要强制要求官方工具存在并通过：

```bash
WORKBUDDY_SKILL_LIBRARY=/path/to/skill-library npm run verify:workbuddy:official
```

`dist/index.html` 是含数据库 placeholder 的公共模板，不应直接导入 WorkBuddy。

## 给自己的 WorkBuddy 打包

生成本地映射模板，或在 manifest 新增 binding 后补齐缺失项：

```bash
npm run setup:local
```

填写已被 `.gitignore` 排除的 `workbuddy.local.json` 后运行：

```bash
npm run package:workbuddy
```

脚本会生成 `release/ping-class-workbuddy.zip`，并使用本地实际 databaseId 重新执行 WorkBuddy 官方 lint 和解析器。ZIP 根目录只含 `index.html`，不会包含源码、Mock、本地配置或种子数据。

## 给其他 WorkBuddy 用户安装或升级

把下面一条消息发给目标用户自己的 WorkBuddy：

```text
请按照 Ping Class 的 Agent 安装与升级协议安装或升级当前稳定版本。我授权你创建或更新安装状态文档、manifest 当前声明的缺失资料表和 Ping Class 页面，并执行协议允许的非破坏性迁移；我不授权删除字段、修改字段类型、删除记录、清空或覆盖业务数据。安装协议：
https://raw.githubusercontent.com/yihuier/workbuddy-ping-class/main/workbuddy/AGENT_INSTALL.md
```

Agent 会动态处理当前 manifest 的全部 binding：首次安装创建目标用户自己的资料表，以 alias 保存实际 databaseId；后续执行同一条消息时复用原映射、按 schemaVersion 连续升级，并通过原 `nodeBlockId` 更新同一页面。开发者 Mock 与其他用户的业务记录不会进入目标资料库。

## 公共发行

```bash
npm run package:agent
```

生成到已忽略的 `release/`：

- `ping-class-template.html`：只含 manifest placeholder 的单文件模板；
- `workbuddy-manifest.json`：版本、schema、seed policy、migration 和资产校验值；
- `render_workbuddy_template.py`：不访问网络或凭证的离线渲染器；
- `SHA256SUMS`：发行文件校验和。

推送与 `package.json`、app manifest 一致的 `vX.Y.Z` tag 后，GitHub Actions 创建版本化 Release。已发布资产不覆盖；修正使用新版本。

## 扩展功能

新增功能的一般流程：

1. 实现独立的 TypeScript、HTML 与样式模块；
2. 需要新资料表时向 manifest 增加 alias、schema 和 seed policy；
3. 为已有安装增加连续 migration；
4. 如需演示数据，新增以 alias 命名的明确合成 Mock；
5. 运行完整构建、公开检查与个人/Agent 打包验证；
6. 按 [`AGENTS.md`](./AGENTS.md) 创建独立 Conventional Commit。

manifest 负责安装和数据绑定，不会替代业务功能本身的实现与测试。

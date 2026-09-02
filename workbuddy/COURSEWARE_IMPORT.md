# Ping Class 课件导入与更新协议

本文件供 WorkBuddy Agent 执行，不是浏览器脚本。它只处理 Ping Class 课件库中的 HTML、HTM 和 ZIP 网页课件。

稳定协议入口：

```text
https://raw.githubusercontent.com/yihuier/workbuddy-ping-class/main/workbuddy/COURSEWARE_IMPORT.md
```

Ping Class 安装协议入口：

```text
https://raw.githubusercontent.com/yihuier/workbuddy-ping-class/main/workbuddy/AGENT_INSTALL.md
```

## 1. 能力边界

课件由两部分组成：

1. HTML 或 ZIP 通过 WorkBuddy 官方 Page 导入流程保存为独立 Page；
2. 当前用户的 `courseware` 资料表只保存名称、Page 节点 ID、链接、来源文件和版本等索引。

禁止把 HTML、ZIP、Base64 内容或本地绝对路径写入资料表 text 字段。禁止把文件留在 Agent 本机后声称已经入库。

本协议不授权以下操作：

- 发布 Page；
- 删除任何 Page；
- 删除资料表、字段或其它业务记录；
- 创建或覆盖用户没有明确指定的课件；
- 修改 Ping Class 安装状态、Page 或其它 binding；
- 把 Token、上传凭证、签名 URL 或本地路径写入课件记录或回复。

## 2. 前置检查

1. 精确定位唯一安装状态文档，三个身份字段必须同时匹配：
   - appId：`io.github.yihuier.workbuddy-ping-class`
   - 标题：`Ping Class 安装记录 · io.github.yihuier.workbuddy-ping-class`
   - marker：`ping-class-installation-state:v1`
2. 状态必须为 `active`，并且 `databases.courseware.id` 为非空、可访问的实际 databaseId。
3. 使用 WorkBuddy 官方 database 能力读取真实 schema，确认至少存在以下字段和类型：
   - `课件名称`：text
   - `Page节点ID`：text
   - `课件链接`：url
   - `原始文件名`：text
   - `文件格式`：select，含 HTML 和 ZIP
   - `版本号`：number
   - `更新时间`：date
   - `备注`：text
4. 状态缺失、存在多份、不是 active、缺少 `courseware` binding 或 schema 不兼容时停止。提示用户先按 `workbuddy/AGENT_INSTALL.md` 安装或升级；本协议不得自行建表或修复 schema。
5. 用户必须附加恰好一个本地文件。仅接受 `.html`、`.htm`、`.zip`，文件上限 50 MiB；不接受目录、通配符或多个文件。

## 3. 文件安全与完整性

- 按 WorkBuddy 当前 skill-library 的 `page/import-flow.md` 执行，不得复制一份旧导入逻辑代替官方脚本。
- HTML/HTM 应为自包含页面；如果引用本地 CSS、JS、字体或图片，要求用户改用 ZIP 并把资源放在同一包中。
- ZIP 必须至少包含一个 HTML/HTM 入口，引用资源必须保持正确相对路径。
- 只读检查 ZIP 条目，发现绝对路径、`..` 路径穿越、符号链接、异常重复条目或可疑解压膨胀时停止；不得自行解压到工作区。
- 按官方图片托管、自检和错误处理要求执行。没有通过官方导入前置检查时不得上传。
- 若页面含 `window.__SMART_PAGE__.database` 调用、未知数据库依赖或需要额外凭证，停止并向用户说明。课件导入不得擅自绑定其它资料表。

## 4. 判断新建还是更新

### 4.1 新建课件

用户指令没有提供 `课件记录ID` 和 `Page节点ID` 时，只能走新建流程。

用户授权范围必须同时包含：创建一个课件 Page、导入成功后向 `courseware` 表新增一条索引。缺少任一授权时先询问，不执行远端写入。

### 4.2 更新已有课件

只有用户指令同时提供 `课件记录ID` 和 `Page节点ID` 时才能走更新流程：

1. 用官方 `get_database_record.py` 从当前安装的 `courseware` 表读取该记录；
2. 记录中的 `Page节点ID` 必须与用户指令完全一致；
3. 读取当前 `版本号`，必须是大于等于 1 的数字；
4. 任一 ID 缺失、不匹配、记录不存在或 Page 不可访问时停止，不猜测、不改为新建。

## 5. 新建课件流程

1. 确定课件名称：优先使用用户明确给出的名称；否则 HTML 使用 `<title>` / `<h1>` 的语义名称，ZIP 使用去除后缀的原始文件名。无法得到可读名称时询问用户。
2. 原始文件名只取 basename，不保存本地目录。
3. 若安装状态中的 `pageNodeBlockId` 与 `targetSpaceId` 均有效且匹配，将课件作为 Ping Class Page 的子节点导入：调用官方 `page/import_html.py` 时同时传 `--parent-id` 与 `--space-id`。
4. 无法安全确定匹配的父节点和 space 时，不传二者，按官方默认位置导入；不得拼凑 spaceId。
5. 静态课件不传 `--databases`，不调用发布能力。
6. 只有 stdout 出现 `KS_IMPORT_OK` 且 JSON 中同时得到非空 `node_block_id` 和协作态 `url` 才算 Page 导入成功。
7. Page 成功后，使用当前 skill-library 的 `database/batch_add_database_records.py` 向 `courseware` 表写入一条记录：

```json
[
  {
    "课件名称": { "text": "<语义名称>" },
    "Page节点ID": { "text": "<node_block_id>" },
    "课件链接": { "url": { "text": "打开课件", "link": "<协作态 url>" } },
    "原始文件名": { "text": "<basename>" },
    "文件格式": { "select": "<HTML 或 ZIP>" },
    "版本号": { "number": 1 },
    "更新时间": { "date": "<当前 ISO-8601 时间>" },
    "备注": { "text": "<用户明确提供的备注，否则空字符串>" }
  }
]
```

8. 检查批量写入结果中该记录 `success=true` 并取得记录 ID，才可宣称导入完成。

如果 Page 已导入但索引写入失败：不得删除 Page，不得再次导入同一文件。向用户报告“Page 已创建、索引登记失败”，给出 nodeBlockId 和协作态 URL，并只重试索引登记步骤。

## 6. 更新已有课件流程

1. 完成 §4.2 的双 ID 校验。
2. 使用用户提供的新文件调用官方 `page/import_html.py --node-block-id <已校验的 Page节点ID>`，覆盖更新同一个 Page；不得传另一个 nodeBlockId，不得退化为新建。
3. 更新场景不传 `--parent-id` 或 `--space-id`，不发布 Page。
4. 只有收到 `KS_IMPORT_OK` 后才更新索引记录。
5. 使用 `database/batch_update_database_records.py` 增量更新该课件记录：
   - `课件链接`：本次返回的协作态 URL；
   - `原始文件名`：新文件 basename；
   - `文件格式`：HTML 或 ZIP；
   - `版本号`：原版本号加 1；
   - `更新时间`：当前 ISO-8601 时间；
   - 用户本轮明确要求改名或改备注时，才更新 `课件名称` 或 `备注`。
6. 检查单条更新结果 `success=true` 后才可宣称完成。

如果 Page 更新成功但索引更新失败：不得重复上传文件。报告 Page 已更新但索引未同步，并只重试资料表增量更新。

## 7. 幂等与失败处理

- 任何脚本都必须解析结构化成功输出，不能以进程退出码或“无报错”代替成功判定。
- 新建流程一旦拿到 nodeBlockId，后续恢复必须复用它，禁止重复创建 Page。
- 更新流程一旦 Page 返回成功，后续恢复只处理索引，不得重复覆盖上传。
- 对网络超时等不确定结果，先查询目标 Page 或索引记录确认状态，再决定是否重试。
- 不自动清理孤立 Page；需要删除时必须由用户另行明确授权并走 WorkBuddy 官方删除流程。

## 8. 成功回执

新建成功时说明：课件名称、格式、版本 `v1`、课件记录 ID、协作态访问链接。

更新成功时说明：课件名称、原版本与新版本、课件记录 ID、复用的 Page 节点 ID、协作态访问链接。

不要回显 Token、签名 URL、本地绝对路径、上传凭证或工具原始响应。

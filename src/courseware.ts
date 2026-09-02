import type { DatabaseRecord, DatabaseSchema, UrlValue } from "./workbuddy";

const COURSEWARE_DATABASE_ID = "__PING_CLASS_DB_COURSEWARE__";
const COURSEWARE_IMPORT_PROTOCOL_URL =
  "https://raw.githubusercontent.com/yihuier/workbuddy-ping-class/main/workbuddy/COURSEWARE_IMPORT.md";

interface CoursewareItem {
  id: string;
  name: string;
  pageNodeBlockId: string;
  link: UrlValue | null;
  version: number;
  updatedAt: string;
  note: string;
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`课件管理页面缺少必要元素: ${selector}`);
  return element;
}

const elements = {
  importButton: requiredElement<HTMLButtonElement>("#import-courseware-button"),
  refreshButton: requiredElement<HTMLButtonElement>("#refresh-courseware-button"),
  search: requiredElement<HTMLInputElement>("#courseware-search-input"),
  count: requiredElement<HTMLSpanElement>("#courseware-count"),
  grid: requiredElement<HTMLDivElement>("#courseware-grid"),
  empty: requiredElement<HTMLDivElement>("#courseware-empty"),
  notice: requiredElement<HTMLDivElement>("#courseware-notice"),
  importDialog: requiredElement<HTMLDialogElement>("#courseware-import-dialog"),
  importTitle: requiredElement<HTMLElement>("#courseware-import-title"),
  importDescription: requiredElement<HTMLElement>("#courseware-import-description"),
  importPrompt: requiredElement<HTMLTextAreaElement>("#courseware-import-prompt"),
  copyStatus: requiredElement<HTMLParagraphElement>("#courseware-copy-status"),
  closeImport: requiredElement<HTMLButtonElement>("#close-courseware-import"),
  cancelImport: requiredElement<HTMLButtonElement>("#cancel-courseware-import"),
  copyPrompt: requiredElement<HTMLButtonElement>("#copy-courseware-prompt"),
  importedRefresh: requiredElement<HTMLButtonElement>("#courseware-imported-refresh"),
  editDialog: requiredElement<HTMLDialogElement>("#courseware-edit-dialog"),
  editForm: requiredElement<HTMLFormElement>("#courseware-edit-form"),
  editName: requiredElement<HTMLInputElement>("#courseware-edit-name"),
  editNote: requiredElement<HTMLTextAreaElement>("#courseware-edit-note"),
  editMeta: requiredElement<HTMLDListElement>("#courseware-edit-meta"),
  editStatus: requiredElement<HTMLParagraphElement>("#courseware-edit-status"),
  closeEdit: requiredElement<HTMLButtonElement>("#close-courseware-edit"),
  cancelEdit: requiredElement<HTMLButtonElement>("#cancel-courseware-edit"),
  submitEdit: requiredElement<HTMLButtonElement>("#submit-courseware-edit"),
  removeDialog: requiredElement<HTMLDialogElement>("#courseware-remove-dialog"),
  removeName: requiredElement<HTMLElement>("#courseware-remove-name"),
  removeStatus: requiredElement<HTMLParagraphElement>("#courseware-remove-status"),
  closeRemove: requiredElement<HTMLButtonElement>("#close-courseware-remove"),
  cancelRemove: requiredElement<HTMLButtonElement>("#cancel-courseware-remove"),
  confirmRemove: requiredElement<HTMLButtonElement>("#confirm-courseware-remove"),
};

let coursewareItems: CoursewareItem[] = [];
let searchText = "";
let editingItem: CoursewareItem | null = null;
let removingItem: CoursewareItem | null = null;
let loading = false;
let editing = false;
let removing = false;
let noticeTimer: number | undefined;

function setDatabaseBinding(element: HTMLElement): void {
  element.setAttribute("data-sp-bindable", "database");
  element.setAttribute("data-sp-database-id", COURSEWARE_DATABASE_ID);
}

function valueAsText(record: DatabaseRecord, fieldName: string): string {
  const value = record[fieldName];
  if (value === null || value === undefined || typeof value === "object") return "";
  return String(value);
}

function valueAsNumber(record: DatabaseRecord, fieldName: string): number {
  const value = record[fieldName];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function valueAsUrl(record: DatabaseRecord, fieldName: string): UrlValue | null {
  const value = record[fieldName];
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.link === "string" &&
    typeof value.text === "string"
  ) {
    return { text: value.text, link: value.link };
  }
  return null;
}

function toCoursewareItem(record: DatabaseRecord): CoursewareItem {
  const originalFileName = valueAsText(record, "原始文件名").trim();
  return {
    id: record._id,
    name: valueAsText(record, "课件名称").trim() || originalFileName || "未命名课件",
    pageNodeBlockId: valueAsText(record, "Page节点ID").trim(),
    link: valueAsUrl(record, "课件链接"),
    version: Math.max(1, Math.trunc(valueAsNumber(record, "版本号"))),
    updatedAt: valueAsText(record, "更新时间"),
    note: valueAsText(record, "备注"),
  };
}

function safeHttpUrl(rawUrl: string): string {
  if (!rawUrl.trim()) return "";
  try {
    const url = new URL(rawUrl, window.location.href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function formatDate(value: string): string {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function showNotice(message: string, type: "success" | "error"): void {
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
  elements.notice.textContent = message;
  elements.notice.className = `inline-notice ${type}`;
  elements.notice.hidden = false;
  if (type === "success") {
    noticeTimer = window.setTimeout(() => {
      elements.notice.hidden = true;
      noticeTimer = undefined;
    }, 5000);
  }
}

function hideNotice(): void {
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
  noticeTimer = undefined;
  elements.notice.hidden = true;
}

function validateCoursewareSchema(schema: DatabaseSchema): void {
  const expectedFields = [
    { name: "课件名称", type: "text" },
    { name: "Page节点ID", type: "text" },
    { name: "课件链接", type: "url" },
    { name: "原始文件名", type: "text" },
    { name: "文件格式", type: "select" },
    { name: "版本号", type: "number" },
    { name: "更新时间", type: "date" },
    { name: "备注", type: "text" },
  ];
  const invalidField = expectedFields.find(({ name, type }) => {
    const field = schema.properties.find((property) => property.name === name);
    return !field || field.type !== type;
  });
  if (invalidField) throw new Error(`课件表缺少有效的「${invalidField.name}」字段`);
}

async function queryAllCourseware(): Promise<DatabaseRecord[]> {
  const rows: DatabaseRecord[] = [];
  let startCursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const result = await window.__SMART_PAGE__.database.query({
      databaseId: "__PING_CLASS_DB_COURSEWARE__",
      pageSize: 100,
      startCursor,
      sorts: [{ property: "更新时间", direction: "descending" }],
    });
    rows.push(...result.results);
    hasMore = result.hasMore;
    startCursor = result.nextCursor ?? undefined;
    if (hasMore && !startCursor) throw new Error("课件表分页游标缺失");
  }
  return rows;
}

function filteredItems(): CoursewareItem[] {
  const keyword = searchText.trim().toLocaleLowerCase("zh-CN");
  return coursewareItems.filter((item) => {
    if (!keyword) return true;
    return [item.name, item.note]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword));
  });
}

function createMetaItem(labelText: string, valueText: string): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "courseware-card-meta-item";
  const label = document.createElement("span");
  label.textContent = labelText;
  const value = document.createElement("strong");
  value.textContent = valueText;
  setDatabaseBinding(value);
  item.append(label, value);
  return item;
}

function actionButton(label: string, className: string, handler: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function createCoursewareCard(item: CoursewareItem): HTMLElement {
  const card = document.createElement("article");
  card.className = "courseware-card";
  card.setAttribute("role", "listitem");
  setDatabaseBinding(card);

  const header = document.createElement("div");
  header.className = "courseware-card-header";
  const title = document.createElement("h2");
  title.textContent = item.name;
  const version = document.createElement("span");
  version.className = "courseware-version";
  version.textContent = `v${item.version}`;
  header.append(title, version);

  const meta = document.createElement("div");
  meta.className = "courseware-card-meta";
  meta.append(
    createMetaItem("更新时间", formatDate(item.updatedAt)),
    createMetaItem("Page 节点", item.pageNodeBlockId ? "已关联" : "未关联"),
  );

  const note = document.createElement("p");
  note.className = `courseware-note${item.note ? "" : " muted"}`;
  note.textContent = item.note || "暂无备注";

  const actions = document.createElement("div");
  actions.className = "courseware-card-actions";
  const safeLink = safeHttpUrl(item.link?.link ?? "");
  if (safeLink) {
    const openLink = document.createElement("a");
    openLink.className = "courseware-card-link primary";
    openLink.href = safeLink;
    openLink.target = "_blank";
    openLink.rel = "noopener noreferrer";
    openLink.textContent = "打开课件";
    openLink.setAttribute("aria-label", `打开课件：${item.name}`);
    actions.append(openLink);
  } else {
    const unavailable = document.createElement("button");
    unavailable.type = "button";
    unavailable.className = "courseware-card-link";
    unavailable.textContent = "链接不可用";
    unavailable.disabled = true;
    actions.append(unavailable);
  }
  actions.append(
    actionButton("编辑信息", "courseware-card-link", () => openEditDialog(item)),
    actionButton("更新课件", "courseware-card-link", () => openImportDialog(item)),
    actionButton("移除索引", "courseware-card-link danger", () => openRemoveDialog(item)),
  );

  card.append(header, meta, note, actions);
  return card;
}

function renderCourseware(): void {
  const items = filteredItems();
  elements.count.textContent = `${items.length} / ${coursewareItems.length} 个课件`;
  if (!items.length) {
    elements.grid.replaceChildren();
    elements.empty.hidden = false;
    const keyword = searchText.trim();
    elements.empty.textContent = keyword
      ? `没有找到与「${keyword}」匹配的课件`
      : "课件库还是空的，可以通过 WorkBuddy Agent 导入第一个课件。";
    setDatabaseBinding(elements.empty);
    return;
  }
  elements.empty.hidden = true;
  elements.grid.replaceChildren(...items.map(createCoursewareCard));
}

function showLoading(): void {
  const loadingCard = document.createElement("div");
  loadingCard.className = "courseware-loading";
  loadingCard.textContent = "正在加载课件库…";
  setDatabaseBinding(loadingCard);
  elements.grid.replaceChildren(loadingCard);
  elements.empty.hidden = true;
  elements.count.textContent = "";
}

function showLoadError(message: string): void {
  elements.grid.replaceChildren();
  elements.empty.hidden = false;
  elements.empty.textContent = message;
  elements.count.textContent = "";
  setDatabaseBinding(elements.empty);
}

async function loadCourseware(): Promise<void> {
  if (loading) return;
  if (!window.__SMART_PAGE__?.database) {
    showLoadError("WorkBuddy Database SDK 未注入，无法加载课件库。");
    return;
  }
  loading = true;
  elements.importButton.disabled = true;
  elements.refreshButton.disabled = true;
  showLoading();
  try {
    const [schema, rows] = await Promise.all([
      window.__SMART_PAGE__.database.getSchema({
        databaseId: "__PING_CLASS_DB_COURSEWARE__",
      }),
      queryAllCourseware(),
    ]);
    validateCoursewareSchema(schema);
    coursewareItems = rows.map(toCoursewareItem);
    renderCourseware();
    elements.importButton.disabled = false;
    elements.refreshButton.disabled = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    showLoadError(`课件库加载失败：${message}`);
  } finally {
    loading = false;
    elements.refreshButton.disabled = false;
  }
}

function importPrompt(item?: CoursewareItem): string {
  if (!item) {
    return [
      "请按照 Ping Class 的课件导入与更新协议，将我附带的课件文件导入当前 Ping Class 的课件库。",
      "我授权你创建一个新的课件 Page，并在导入成功后向当前安装的 courseware 资料表新增索引记录；我不授权你发布课件、删除任何 Page、覆盖已有课件或修改其它业务数据。",
      `协议：${COURSEWARE_IMPORT_PROTOCOL_URL}`,
    ].join("\n\n");
  }
  return [
    "请按照 Ping Class 的课件导入与更新协议，用我附带的课件文件更新下面这一个课件。",
    `课件记录ID：${item.id}`,
    `Page节点ID：${item.pageNodeBlockId}`,
    `当前版本：${item.version}`,
    "我授权你覆盖更新这个 Page 节点，并在成功后更新对应的 courseware 索引记录；我不授权你新建另一个课件、发布课件、删除任何 Page 或修改其它业务数据。若记录ID和Page节点ID不匹配，请停止并向我说明。",
    `协议：${COURSEWARE_IMPORT_PROTOCOL_URL}`,
  ].join("\n\n");
}

function openImportDialog(item?: CoursewareItem): void {
  const updating = Boolean(item);
  elements.importTitle.textContent = updating ? "更新课件" : "导入新课件";
  elements.importDescription.textContent = updating
    ? `更新「${item?.name ?? ""}」的既有 WorkBuddy Page，并保留同一条课件索引。`
    : "通过 WorkBuddy Agent 安全导入课件，并自动登记到课件表。";
  elements.importPrompt.value = importPrompt(item);
  elements.copyStatus.hidden = true;
  elements.copyStatus.textContent = "";
  elements.importDialog.showModal();
  window.requestAnimationFrame(() => elements.copyPrompt.focus());
}

function closeImportDialog(): void {
  if (!elements.importDialog.open) return;
  elements.importDialog.close();
  elements.importButton.focus();
}

function showCopyStatus(message: string, type: "success" | "error"): void {
  elements.copyStatus.textContent = message;
  elements.copyStatus.className = `courseware-copy-status ${type}`;
  elements.copyStatus.hidden = false;
}

async function copyImportPrompt(): Promise<void> {
  const prompt = elements.importPrompt.value;
  let copied = false;
  try {
    await navigator.clipboard.writeText(prompt);
    copied = true;
  } catch {
    elements.importPrompt.focus();
    elements.importPrompt.select();
    copied = document.execCommand("copy");
  }
  showCopyStatus(
    copied ? "导入指令已复制。请粘贴到 WorkBuddy 对话并附加课件文件。" : "自动复制失败，请手动选择并复制上面的指令。",
    copied ? "success" : "error",
  );
}

function appendReadonlyMeta(label: string, value: string): void {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  setDatabaseBinding(description);
  elements.editMeta.append(term, description);
}

function setEditSubmitting(submitting: boolean): void {
  editing = submitting;
  elements.editName.disabled = submitting;
  elements.editNote.disabled = submitting;
  elements.closeEdit.disabled = submitting;
  elements.cancelEdit.disabled = submitting;
  elements.submitEdit.disabled = submitting;
  elements.submitEdit.textContent = submitting ? "正在保存…" : "保存修改";
}

function openEditDialog(item: CoursewareItem): void {
  editingItem = item;
  elements.editName.value = item.name;
  elements.editNote.value = item.note;
  elements.editMeta.replaceChildren();
  appendReadonlyMeta("当前版本", `v${item.version}`);
  appendReadonlyMeta("更新时间", formatDate(item.updatedAt));
  elements.editStatus.hidden = true;
  elements.editStatus.textContent = "";
  elements.editDialog.showModal();
  window.requestAnimationFrame(() => elements.editName.focus());
}

function closeEditDialog(): void {
  if (editing || !elements.editDialog.open) return;
  elements.editDialog.close();
  editingItem = null;
}

async function submitEdit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (editing || !editingItem) return;
  elements.editStatus.hidden = true;
  const name = elements.editName.value.trim();
  const note = elements.editNote.value.trim();
  elements.editName.setCustomValidity(name ? "" : "请输入课件名称");
  if (!elements.editForm.reportValidity()) return;

  const item = editingItem;
  setEditSubmitting(true);
  try {
    await window.__SMART_PAGE__.database.updateRecord({
      databaseId: "__PING_CLASS_DB_COURSEWARE__",
      recordId: item.id,
      properties: {
        "课件名称": { text: name },
        "备注": { text: note },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    elements.editStatus.textContent = `保存失败：${message}`;
    elements.editStatus.hidden = false;
    setEditSubmitting(false);
    return;
  }

  elements.editDialog.close();
  editingItem = null;
  setEditSubmitting(false);
  await loadCourseware();
  showNotice(`课件「${name}」的信息已更新。`, "success");
}

function setRemoveSubmitting(submitting: boolean): void {
  removing = submitting;
  elements.closeRemove.disabled = submitting;
  elements.cancelRemove.disabled = submitting;
  elements.confirmRemove.disabled = submitting;
  elements.confirmRemove.textContent = submitting ? "正在移除…" : "仅移除索引";
}

function openRemoveDialog(item: CoursewareItem): void {
  removingItem = item;
  elements.removeName.textContent = `「${item.name}」`;
  setDatabaseBinding(elements.removeName);
  elements.removeStatus.hidden = true;
  elements.removeStatus.textContent = "";
  elements.removeDialog.showModal();
  window.requestAnimationFrame(() => elements.cancelRemove.focus());
}

function closeRemoveDialog(): void {
  if (removing || !elements.removeDialog.open) return;
  elements.removeDialog.close();
  removingItem = null;
}

async function removeCoursewareIndex(): Promise<void> {
  if (removing || !removingItem) return;
  const item = removingItem;
  setRemoveSubmitting(true);
  try {
    await window.__SMART_PAGE__.database.deleteRecord({
      databaseId: "__PING_CLASS_DB_COURSEWARE__",
      recordId: item.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    elements.removeStatus.textContent = `移除失败：${message}`;
    elements.removeStatus.hidden = false;
    setRemoveSubmitting(false);
    return;
  }

  elements.removeDialog.close();
  removingItem = null;
  setRemoveSubmitting(false);
  await loadCourseware();
  showNotice(`已从列表移除「${item.name}」；对应 WorkBuddy Page 未被删除。`, "success");
}

function registerDialogClose(
  dialog: HTMLDialogElement,
  close: () => void,
  blocked: () => boolean,
): void {
  dialog.addEventListener("cancel", (event) => {
    if (blocked()) event.preventDefault();
    else {
      event.preventDefault();
      close();
    }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && !blocked()) close();
  });
}

function registerEvents(): void {
  elements.search.addEventListener("input", () => {
    searchText = elements.search.value;
    renderCourseware();
  });
  elements.refreshButton.addEventListener("click", () => void loadCourseware());
  elements.importButton.addEventListener("click", () => openImportDialog());
  elements.closeImport.addEventListener("click", closeImportDialog);
  elements.cancelImport.addEventListener("click", closeImportDialog);
  elements.copyPrompt.addEventListener("click", () => void copyImportPrompt());
  elements.importedRefresh.addEventListener("click", () => {
    closeImportDialog();
    void loadCourseware();
  });
  registerDialogClose(elements.importDialog, closeImportDialog, () => false);

  elements.editForm.addEventListener("submit", (event) => void submitEdit(event));
  elements.editName.addEventListener("input", () => {
    elements.editName.setCustomValidity("");
    elements.editStatus.hidden = true;
  });
  elements.editNote.addEventListener("input", () => {
    elements.editStatus.hidden = true;
  });
  elements.closeEdit.addEventListener("click", closeEditDialog);
  elements.cancelEdit.addEventListener("click", closeEditDialog);
  registerDialogClose(elements.editDialog, closeEditDialog, () => editing);

  elements.confirmRemove.addEventListener("click", () => void removeCoursewareIndex());
  elements.closeRemove.addEventListener("click", closeRemoveDialog);
  elements.cancelRemove.addEventListener("click", closeRemoveDialog);
  registerDialogClose(elements.removeDialog, closeRemoveDialog, () => removing);
}

export async function startCourseware(): Promise<void> {
  registerEvents();
  hideNotice();
  await loadCourseware();
}

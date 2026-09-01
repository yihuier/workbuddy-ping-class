import type { DatabaseRecord, DatabaseSchema } from "./workbuddy";

const SLOT_DATABASE_ID = "__PING_CLASS_DB_LESSON_SLOTS__";
const TIMETABLE_DATABASE_ID = "__PING_CLASS_DB_WEEKLY_TIMETABLE__";
const CLASS_DATABASE_ID = "__PING_CLASS_DB_CLASSES__";
const SCHEDULE_DRAFT_KEY = "ping-class:schedule-draft:v1";
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

interface LessonSlot {
  id: string;
  name: string;
  order: number;
  startTime: string;
  endTime: string;
}

interface WeeklyScheduleEntry {
  id: string;
  weekday: number;
  slotId: string;
  classId: string;
  className: string;
}

interface ScheduleClass {
  id: string;
  name: string;
}

interface ScheduleDraft {
  weekday: string;
  slotId: string;
  classId: string;
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`课表页面缺少必要元素: ${selector}`);
  return element;
}

const elements = {
  addButton: requiredElement<HTMLButtonElement>("#add-schedule-button"),
  slotSettingsButton: requiredElement<HTMLButtonElement>("#slot-settings-button"),
  todayButton: requiredElement<HTMLButtonElement>("#schedule-today-button"),
  prevButton: requiredElement<HTMLButtonElement>("#schedule-prev-button"),
  nextButton: requiredElement<HTMLButtonElement>("#schedule-next-button"),
  weekLabel: requiredElement<HTMLElement>("#schedule-week-label"),
  count: requiredElement<HTMLSpanElement>("#schedule-count"),
  grid: requiredElement<HTMLTableElement>("#schedule-grid"),
  agendaTitle: requiredElement<HTMLElement>("#schedule-agenda-title"),
  agendaList: requiredElement<HTMLDivElement>("#schedule-agenda-list"),
  notice: requiredElement<HTMLDivElement>("#schedule-notice"),
  dialog: requiredElement<HTMLDialogElement>("#schedule-dialog"),
  form: requiredElement<HTMLFormElement>("#schedule-form"),
  dialogTitle: requiredElement<HTMLElement>("#schedule-dialog-title"),
  dialogDescription: requiredElement<HTMLElement>("#schedule-dialog-description"),
  weekday: requiredElement<HTMLSelectElement>("#schedule-weekday"),
  slot: requiredElement<HTMLSelectElement>("#schedule-slot"),
  classSelect: requiredElement<HTMLSelectElement>("#schedule-class"),
  formStatus: requiredElement<HTMLParagraphElement>("#schedule-form-status"),
  closeDialog: requiredElement<HTMLButtonElement>("#close-schedule-dialog"),
  cancelDialog: requiredElement<HTMLButtonElement>("#cancel-schedule-dialog"),
  submitButton: requiredElement<HTMLButtonElement>("#submit-schedule-button"),
  deleteButton: requiredElement<HTMLButtonElement>("#delete-schedule-button"),
  slotDialog: requiredElement<HTMLDialogElement>("#slot-settings-dialog"),
  closeSlotDialog: requiredElement<HTMLButtonElement>("#close-slot-settings"),
  slotList: requiredElement<HTMLDivElement>("#slot-settings-list"),
  slotForm: requiredElement<HTMLFormElement>("#slot-form"),
  slotFormTitle: requiredElement<HTMLElement>("#slot-form-title"),
  slotName: requiredElement<HTMLInputElement>("#slot-name"),
  slotOrder: requiredElement<HTMLInputElement>("#slot-order"),
  slotStartTime: requiredElement<HTMLInputElement>("#slot-start-time"),
  slotEndTime: requiredElement<HTMLInputElement>("#slot-end-time"),
  slotFormStatus: requiredElement<HTMLParagraphElement>("#slot-form-status"),
  cancelSlotEdit: requiredElement<HTMLButtonElement>("#cancel-slot-edit"),
  submitSlotButton: requiredElement<HTMLButtonElement>("#submit-slot-button"),
};

let lessonSlots: LessonSlot[] = [];
let weeklyEntries: WeeklyScheduleEntry[] = [];
let scheduleClasses: ScheduleClass[] = [];
let selectedDate = atStartOfDay(new Date());
let visibleWeekStart = getWeekStart(selectedDate);
let scheduleReady = false;
let scheduleSubmitting = false;
let slotSubmitting = false;
let editingEntryId: string | null = null;
let editingSlotId: string | null = null;
let draftSaveTimer: number | undefined;
let noticeTimer: number | undefined;

function valueAsText(record: DatabaseRecord, fieldName: string): string {
  const value = record[fieldName];
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "object") return "";
  return String(value);
}

function valueAsNumber(record: DatabaseRecord, fieldName: string): number {
  const value = record[fieldName];
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function setDatabaseBinding(
  element: HTMLElement,
  source: "slots" | "timetable" | "classes",
): void {
  const databaseId =
    source === "slots"
      ? SLOT_DATABASE_ID
      : source === "timetable"
        ? TIMETABLE_DATABASE_ID
        : CLASS_DATABASE_ID;
  element.setAttribute("data-sp-bindable", "database");
  element.setAttribute("data-sp-database-id", databaseId);
}

function atStartOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number): Date {
  const result = atStartOfDay(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function getWeekStart(date: Date): Date {
  const weekday = date.getDay();
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

function weekdayNumber(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

function isSameDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatWeekRange(start: Date): string {
  const end = addDays(start, 6);
  if (start.getFullYear() === end.getFullYear()) {
    if (start.getMonth() === end.getMonth()) {
      return `${start.getFullYear()} 年 ${start.getMonth() + 1} 月 ${start.getDate()} – ${end.getDate()} 日`;
    }
    return `${start.getFullYear()} 年 ${start.getMonth() + 1} 月 ${start.getDate()} 日 – ${end.getMonth() + 1} 月 ${end.getDate()} 日`;
  }
  return `${start.getFullYear()} 年 ${start.getMonth() + 1} 月 ${start.getDate()} 日 – ${end.getFullYear()} 年 ${end.getMonth() + 1} 月 ${end.getDate()} 日`;
}

function formatAgendaDate(date: Date): string {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${WEEKDAY_LABELS[weekdayNumber(date) - 1]}`;
}

function slotTime(slot: LessonSlot): string {
  if (!slot.startTime && !slot.endTime) return "时间未设置";
  return `${slot.startTime || "--:--"}–${slot.endTime || "--:--"}`;
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

async function queryAllSlots(): Promise<DatabaseRecord[]> {
  const rows: DatabaseRecord[] = [];
  let startCursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const result = await window.__SMART_PAGE__.database.query({
      databaseId: "__PING_CLASS_DB_LESSON_SLOTS__",
      pageSize: 100,
      startCursor,
      sorts: [{ property: "排序", direction: "ascending" }],
    });
    rows.push(...result.results);
    hasMore = result.hasMore;
    startCursor = result.nextCursor ?? undefined;
    if (hasMore && !startCursor) throw new Error("节次配置表分页游标缺失");
  }
  return rows;
}

async function queryAllWeeklyEntries(): Promise<DatabaseRecord[]> {
  const rows: DatabaseRecord[] = [];
  let startCursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const result = await window.__SMART_PAGE__.database.query({
      databaseId: "__PING_CLASS_DB_WEEKLY_TIMETABLE__",
      pageSize: 100,
      startCursor,
      sorts: [{ property: "星期", direction: "ascending" }],
    });
    rows.push(...result.results);
    hasMore = result.hasMore;
    startCursor = result.nextCursor ?? undefined;
    if (hasMore && !startCursor) throw new Error("周课表表分页游标缺失");
  }
  return rows;
}

async function queryAllScheduleClasses(): Promise<DatabaseRecord[]> {
  const rows: DatabaseRecord[] = [];
  let startCursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const result = await window.__SMART_PAGE__.database.query({
      databaseId: "__PING_CLASS_DB_CLASSES__",
      pageSize: 100,
      startCursor,
    });
    rows.push(...result.results);
    hasMore = result.hasMore;
    startCursor = result.nextCursor ?? undefined;
    if (hasMore && !startCursor) throw new Error("班级表分页游标缺失");
  }
  return rows;
}

function validateSchema(
  schema: DatabaseSchema,
  label: string,
  fields: Array<{ name: string; type: string }>,
): void {
  const invalid = fields.find(({ name, type }) => {
    const property = schema.properties.find((item) => item.name === name);
    return !property || property.type !== type;
  });
  if (invalid) throw new Error(`${label}缺少有效的「${invalid.name}」字段`);
}

function parseSlots(rows: DatabaseRecord[]): LessonSlot[] {
  return rows
    .map((row) => ({
      id: row._id,
      name: valueAsText(row, "节次名称").trim(),
      order: valueAsNumber(row, "排序"),
      startTime: valueAsText(row, "开始时间").trim(),
      endTime: valueAsText(row, "结束时间").trim(),
    }))
    .filter((slot) => slot.id && slot.name)
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "zh-CN"));
}

function parseWeeklyEntries(rows: DatabaseRecord[]): WeeklyScheduleEntry[] {
  return rows
    .map((row) => ({
      id: row._id,
      weekday: valueAsNumber(row, "星期"),
      slotId: valueAsText(row, "节次配置ID").trim(),
      classId: valueAsText(row, "班级ID").trim(),
      className: valueAsText(row, "班级名称").trim(),
    }))
    .filter((entry) => entry.id && entry.weekday >= 1 && entry.weekday <= 7 && entry.slotId);
}

function parseClasses(rows: DatabaseRecord[]): ScheduleClass[] {
  return rows
    .map((row) => ({ id: row._id, name: valueAsText(row, "班级名称").trim() }))
    .filter((item) => item.id && item.name)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
}

function classNameForEntry(entry: WeeklyScheduleEntry): string {
  return scheduleClasses.find((item) => item.id === entry.classId)?.name || entry.className || "班级已移除";
}

function slotForEntry(entry: WeeklyScheduleEntry): LessonSlot | undefined {
  return lessonSlots.find((slot) => slot.id === entry.slotId);
}

function entrySort(left: WeeklyScheduleEntry, right: WeeklyScheduleEntry): number {
  const leftSlot = slotForEntry(left);
  const rightSlot = slotForEntry(right);
  return (leftSlot?.order ?? 999) - (rightSlot?.order ?? 999);
}

function renderWeekdayOptions(): void {
  const options = WEEKDAY_LABELS.map((label, index) => {
    const option = document.createElement("option");
    option.value = String(index + 1);
    option.textContent = label;
    return option;
  });
  elements.weekday.replaceChildren(...options);
}

function renderSlotOptions(selectedSlotId = ""): void {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = lessonSlots.length ? "请选择节次" : "请先配置节次";

  const options = lessonSlots.map((slot) => {
    const option = document.createElement("option");
    option.value = slot.id;
    option.textContent = `${slot.name} · ${slotTime(slot)}`;
    setDatabaseBinding(option, "slots");
    return option;
  });
  elements.slot.replaceChildren(placeholder, ...options);
  elements.slot.value = selectedSlotId;
}

function renderClassOptions(selectedClassId = "", fallbackName = ""): void {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = scheduleClasses.length ? "请选择班级" : "请先新增班级";

  const options = scheduleClasses.map((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    setDatabaseBinding(option, "classes");
    return option;
  });

  if (selectedClassId && !scheduleClasses.some((item) => item.id === selectedClassId)) {
    const legacyOption = document.createElement("option");
    legacyOption.value = selectedClassId;
    legacyOption.textContent = fallbackName || "原班级（已从班级表移除）";
    setDatabaseBinding(legacyOption, "timetable");
    options.push(legacyOption);
  }

  elements.classSelect.replaceChildren(placeholder, ...options);
  elements.classSelect.value = selectedClassId;
}

function updateControls(): void {
  elements.slotSettingsButton.disabled = !scheduleReady;
  const addDisabled = !scheduleReady || !lessonSlots.length || !scheduleClasses.length;
  elements.addButton.disabled = addDisabled;
  if (!scheduleReady) {
    elements.addButton.title = "课表数据尚未加载完成";
  } else if (!lessonSlots.length) {
    elements.addButton.title = "请先配置至少一个节次";
  } else if (!scheduleClasses.length) {
    elements.addButton.title = "请先在班级管理中新增班级";
  } else {
    elements.addButton.removeAttribute("title");
  }
}

function createDateHeader(date: Date, index: number): HTMLTableCellElement {
  const header = document.createElement("th");
  header.scope = "col";
  if (isSameDate(date, selectedDate)) header.classList.add("selected-day");
  if (isSameDate(date, new Date())) header.classList.add("today");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "schedule-date-button";
  button.setAttribute("aria-pressed", String(isSameDate(date, selectedDate)));

  const weekday = document.createElement("span");
  weekday.textContent = WEEKDAY_LABELS[index] ?? "";
  const dateLabel = document.createElement("strong");
  dateLabel.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
  button.append(weekday, dateLabel);
  button.addEventListener("click", () => {
    selectedDate = date;
    renderSchedule();
  });
  header.append(button);
  return header;
}

function openScheduleForCell(date: Date, slotId: string, entry?: WeeklyScheduleEntry): void {
  selectedDate = date;
  renderSchedule();
  if (entry) openEditScheduleDialog(entry);
  else openCreateScheduleDialog({ weekday: weekdayNumber(date), slotId });
}

function createScheduleCell(date: Date, slot: LessonSlot): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.className = "schedule-cell";
  if (isSameDate(date, selectedDate)) cell.classList.add("selected-day");
  if (isSameDate(date, new Date())) cell.classList.add("today");

  const entries = weeklyEntries
    .filter((entry) => entry.weekday === weekdayNumber(date) && entry.slotId === slot.id)
    .sort(entrySort);

  if (!entries.length) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "schedule-cell-add";
    add.textContent = "+";
    add.setAttribute("aria-label", `${WEEKDAY_LABELS[weekdayNumber(date) - 1]} ${slot.name} 新增排课`);
    add.addEventListener("click", () => openScheduleForCell(date, slot.id));
    cell.append(add);
    return cell;
  }

  entries.forEach((entry) => {
    const classButton = document.createElement("button");
    classButton.type = "button";
    classButton.className = "schedule-class-block";
    classButton.textContent = classNameForEntry(entry);
    classButton.setAttribute("aria-label", `编辑 ${slot.name} ${classNameForEntry(entry)} 的排课`);
    setDatabaseBinding(classButton, "timetable");
    classButton.addEventListener("click", () => openScheduleForCell(date, slot.id, entry));
    cell.append(classButton);
  });
  return cell;
}

function renderGrid(): void {
  const headerRow = document.createElement("tr");
  const slotHeader = document.createElement("th");
  slotHeader.scope = "col";
  slotHeader.className = "schedule-slot-column";
  slotHeader.textContent = "节次";
  headerRow.append(slotHeader);

  const dates = WEEKDAY_LABELS.map((_label, index) => addDays(visibleWeekStart, index));
  dates.forEach((date, index) => headerRow.append(createDateHeader(date, index)));
  const tableHead = document.createElement("thead");
  tableHead.append(headerRow);

  const tableBody = document.createElement("tbody");
  if (!lessonSlots.length) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 8;
    emptyCell.className = "schedule-table-empty";
    emptyCell.textContent = scheduleReady
      ? "尚未配置节次。请打开“节次设置”，添加第几节课及对应时间。"
      : "正在加载课表数据…";
    setDatabaseBinding(emptyCell, "slots");
    emptyRow.append(emptyCell);
    tableBody.append(emptyRow);
  } else {
    lessonSlots.forEach((slot) => {
      const row = document.createElement("tr");
      const slotCell = document.createElement("th");
      slotCell.scope = "row";
      slotCell.className = "schedule-slot-label";
      const name = document.createElement("strong");
      name.textContent = slot.name;
      const time = document.createElement("span");
      time.textContent = slotTime(slot);
      slotCell.append(name, time);
      setDatabaseBinding(slotCell, "slots");
      row.append(slotCell, ...dates.map((date) => createScheduleCell(date, slot)));
      tableBody.append(row);
    });
  }

  elements.grid.replaceChildren(tableHead, tableBody);
}

function renderAgenda(): void {
  elements.agendaTitle.textContent = formatAgendaDate(selectedDate);
  const entries = weeklyEntries
    .filter((entry) => entry.weekday === weekdayNumber(selectedDate))
    .sort(entrySort);

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "schedule-empty";
    empty.textContent = "当天没有课程安排";
    setDatabaseBinding(empty, "timetable");
    elements.agendaList.replaceChildren(empty);
    return;
  }

  const items = entries.map((entry) => {
    const slot = slotForEntry(entry);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "agenda-item";

    const slotInfo = document.createElement("span");
    slotInfo.className = "agenda-slot";
    const slotName = document.createElement("strong");
    slotName.textContent = slot?.name ?? "未识别节次";
    const time = document.createElement("small");
    time.textContent = slot ? slotTime(slot) : "节次配置已移除";
    slotInfo.append(slotName, time);
    setDatabaseBinding(slotInfo, "slots");

    const className = document.createElement("span");
    className.className = "agenda-class";
    className.textContent = classNameForEntry(entry);
    setDatabaseBinding(className, "timetable");

    item.append(slotInfo, className);
    item.addEventListener("click", () => openEditScheduleDialog(entry));
    return item;
  });
  elements.agendaList.replaceChildren(...items);
}

function renderSchedule(): void {
  elements.weekLabel.textContent = formatWeekRange(visibleWeekStart);
  elements.count.textContent = `${weeklyEntries.length} 个固定安排`;
  renderGrid();
  renderAgenda();
}

function renderScheduleLoading(): void {
  scheduleReady = false;
  updateControls();
  elements.weekLabel.textContent = formatWeekRange(visibleWeekStart);
  elements.count.textContent = "正在加载…";
  renderGrid();
  elements.agendaTitle.textContent = formatAgendaDate(selectedDate);
  const loading = document.createElement("p");
  loading.className = "schedule-empty";
  loading.textContent = "正在加载课程安排…";
  elements.agendaList.replaceChildren(loading);
}

function renderScheduleError(message: string): void {
  scheduleReady = false;
  updateControls();
  elements.count.textContent = "";
  const tableHead = document.createElement("thead");
  const row = document.createElement("tr");
  const cell = document.createElement("th");
  cell.textContent = "课表加载失败";
  row.append(cell);
  tableHead.append(row);
  const tableBody = document.createElement("tbody");
  const errorRow = document.createElement("tr");
  const errorCell = document.createElement("td");
  errorCell.className = "schedule-table-empty error";
  errorCell.textContent = message;
  errorRow.append(errorCell);
  tableBody.append(errorRow);
  elements.grid.replaceChildren(tableHead, tableBody);

  const agendaError = document.createElement("p");
  agendaError.className = "schedule-empty error";
  agendaError.textContent = "无法读取当天课程安排";
  elements.agendaList.replaceChildren(agendaError);
}

function getScheduleDraft(): ScheduleDraft | null {
  try {
    const rawDraft = localStorage.getItem(SCHEDULE_DRAFT_KEY);
    if (!rawDraft) return null;
    const draft = JSON.parse(rawDraft) as Partial<ScheduleDraft>;
    return {
      weekday: typeof draft.weekday === "string" ? draft.weekday : "",
      slotId: typeof draft.slotId === "string" ? draft.slotId : "",
      classId: typeof draft.classId === "string" ? draft.classId : "",
    };
  } catch {
    return null;
  }
}

function saveScheduleDraft(): void {
  if (editingEntryId) return;
  const draft: ScheduleDraft = {
    weekday: elements.weekday.value,
    slotId: elements.slot.value,
    classId: elements.classSelect.value,
  };
  try {
    localStorage.setItem(SCHEDULE_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 浏览器禁用 storage 时静默降级，不阻止排课写入。
  }
}

function scheduleDraftSave(): void {
  if (draftSaveTimer !== undefined) window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(() => {
    saveScheduleDraft();
    draftSaveTimer = undefined;
  }, 250);
}

function clearScheduleDraft(): void {
  if (draftSaveTimer !== undefined) window.clearTimeout(draftSaveTimer);
  draftSaveTimer = undefined;
  try {
    localStorage.removeItem(SCHEDULE_DRAFT_KEY);
  } catch {
    // 浏览器禁用 storage 时无需额外处理。
  }
}

function showScheduleFormError(message: string): void {
  elements.formStatus.textContent = message;
  elements.formStatus.hidden = false;
}

function clearScheduleFormError(): void {
  elements.formStatus.textContent = "";
  elements.formStatus.hidden = true;
}

function setScheduleSubmitting(submitting: boolean): void {
  scheduleSubmitting = submitting;
  elements.weekday.disabled = submitting;
  elements.slot.disabled = submitting;
  elements.classSelect.disabled = submitting;
  elements.closeDialog.disabled = submitting;
  elements.cancelDialog.disabled = submitting;
  elements.deleteButton.disabled = submitting;
  elements.submitButton.disabled = submitting;
  elements.submitButton.textContent = submitting
    ? "正在保存…"
    : editingEntryId
      ? "保存修改"
      : "确认添加";
}

function openCreateScheduleDialog(prefill?: { weekday: number; slotId: string }): void {
  if (elements.addButton.disabled || elements.dialog.open) return;
  editingEntryId = null;
  hideNotice();
  clearScheduleFormError();
  elements.form.reset();
  renderSlotOptions();
  renderClassOptions();

  const draft = getScheduleDraft();
  const weekday = prefill?.weekday ?? (Number(draft?.weekday) || weekdayNumber(selectedDate));
  const slotId = prefill?.slotId ?? draft?.slotId ?? "";
  elements.weekday.value = String(weekday);
  elements.slot.value = lessonSlots.some((slot) => slot.id === slotId) ? slotId : "";
  elements.classSelect.value = scheduleClasses.some((item) => item.id === draft?.classId)
    ? draft?.classId ?? ""
    : "";

  elements.dialogTitle.textContent = "新增排课";
  elements.dialogDescription.textContent = "选择星期、节次和班级，保存为每周固定安排。";
  elements.deleteButton.hidden = true;
  elements.submitButton.textContent = "确认添加";
  elements.dialog.showModal();
  window.requestAnimationFrame(() => elements.weekday.focus());
}

function openEditScheduleDialog(entry: WeeklyScheduleEntry): void {
  if (!scheduleReady || elements.dialog.open) return;
  editingEntryId = entry.id;
  hideNotice();
  clearScheduleFormError();
  renderSlotOptions(entry.slotId);
  renderClassOptions(entry.classId, entry.className);
  elements.weekday.value = String(entry.weekday);
  elements.dialogTitle.textContent = "编辑排课";
  elements.dialogDescription.textContent = "修改后会更新每周固定课表中的对应安排。";
  elements.deleteButton.hidden = false;
  elements.submitButton.textContent = "保存修改";
  elements.dialog.showModal();
  window.requestAnimationFrame(() => elements.weekday.focus());
}

function closeScheduleDialog(): void {
  if (scheduleSubmitting || !elements.dialog.open) return;
  elements.dialog.close();
  editingEntryId = null;
  elements.addButton.focus();
}

function scheduleFormValues(): {
  weekday: number;
  slotId: string;
  classId: string;
  className: string;
} | null {
  const weekday = Number(elements.weekday.value);
  const slotId = elements.slot.value;
  const classId = elements.classSelect.value;
  elements.weekday.setCustomValidity(weekday >= 1 && weekday <= 7 ? "" : "请选择星期");
  elements.slot.setCustomValidity(slotId ? "" : "请选择节次");
  elements.classSelect.setCustomValidity(classId ? "" : "请选择班级");
  if (!elements.form.reportValidity()) return null;

  const duplicate = weeklyEntries.some(
    (entry) =>
      entry.id !== editingEntryId && entry.weekday === weekday && entry.slotId === slotId,
  );
  if (duplicate) {
    showScheduleFormError("这个星期和节次已经有课程，请先编辑或删除原安排。");
    return null;
  }

  const className =
    scheduleClasses.find((item) => item.id === classId)?.name ||
    elements.classSelect.selectedOptions[0]?.textContent?.trim() ||
    "";
  return { weekday, slotId, classId, className };
}

async function submitSchedule(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (scheduleSubmitting) return;
  clearScheduleFormError();
  const values = scheduleFormValues();
  if (!values) return;

  setScheduleSubmitting(true);
  try {
    if (editingEntryId) {
      await window.__SMART_PAGE__.database.updateRecord({
        databaseId: "__PING_CLASS_DB_WEEKLY_TIMETABLE__",
        recordId: editingEntryId,
        properties: {
          "星期": { number: values.weekday },
          "节次配置ID": { text: values.slotId },
          "班级ID": { text: values.classId },
          "班级名称": { text: values.className },
        },
      });
    } else {
      await window.__SMART_PAGE__.database.addRecord({
        databaseId: "__PING_CLASS_DB_WEEKLY_TIMETABLE__",
        properties: {
          "星期": { number: values.weekday },
          "节次配置ID": { text: values.slotId },
          "班级ID": { text: values.classId },
          "班级名称": { text: values.className },
        },
      });
    }
    weeklyEntries = parseWeeklyEntries(await queryAllWeeklyEntries());
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    showScheduleFormError(`保存失败：${message}`);
    setScheduleSubmitting(false);
    return;
  }

  const wasEditing = Boolean(editingEntryId);
  clearScheduleDraft();
  elements.dialog.close();
  editingEntryId = null;
  setScheduleSubmitting(false);
  renderSchedule();
  updateControls();
  elements.addButton.focus();
  showNotice(wasEditing ? "排课已更新。" : "排课已添加。", "success");
}

async function deleteSchedule(): Promise<void> {
  if (!editingEntryId || scheduleSubmitting) return;
  const entry = weeklyEntries.find((item) => item.id === editingEntryId);
  const slot = entry ? slotForEntry(entry) : undefined;
  const label = entry
    ? `${WEEKDAY_LABELS[entry.weekday - 1]} ${slot?.name ?? "该节次"} ${classNameForEntry(entry)}`
    : "这条排课";
  if (!window.confirm(`确认删除「${label}」吗？`)) return;

  setScheduleSubmitting(true);
  try {
    await window.__SMART_PAGE__.database.deleteRecord({
      databaseId: "__PING_CLASS_DB_WEEKLY_TIMETABLE__",
      recordId: editingEntryId,
    });
    weeklyEntries = parseWeeklyEntries(await queryAllWeeklyEntries());
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    showScheduleFormError(`删除失败：${message}`);
    setScheduleSubmitting(false);
    return;
  }

  elements.dialog.close();
  editingEntryId = null;
  setScheduleSubmitting(false);
  renderSchedule();
  updateControls();
  elements.addButton.focus();
  showNotice("排课已删除。", "success");
}

function showSlotFormError(message: string): void {
  elements.slotFormStatus.textContent = message;
  elements.slotFormStatus.hidden = false;
}

function clearSlotFormError(): void {
  elements.slotFormStatus.textContent = "";
  elements.slotFormStatus.hidden = true;
}

function setSlotSubmitting(submitting: boolean): void {
  slotSubmitting = submitting;
  elements.slotName.disabled = submitting;
  elements.slotOrder.disabled = submitting;
  elements.slotStartTime.disabled = submitting;
  elements.slotEndTime.disabled = submitting;
  elements.closeSlotDialog.disabled = submitting;
  elements.cancelSlotEdit.disabled = submitting;
  elements.submitSlotButton.disabled = submitting;
  elements.submitSlotButton.textContent = submitting
    ? "正在保存…"
    : editingSlotId
      ? "保存修改"
      : "添加节次";
}

function resetSlotEditor(): void {
  editingSlotId = null;
  elements.slotForm.reset();
  clearSlotFormError();
  elements.slotFormTitle.textContent = "新增节次";
  elements.cancelSlotEdit.hidden = true;
  elements.submitSlotButton.textContent = "添加节次";
  const nextOrder = lessonSlots.reduce((maximum, slot) => Math.max(maximum, slot.order), 0) + 1;
  elements.slotOrder.value = String(nextOrder);
}

function editSlot(slot: LessonSlot): void {
  editingSlotId = slot.id;
  clearSlotFormError();
  elements.slotName.value = slot.name;
  elements.slotOrder.value = String(slot.order);
  elements.slotStartTime.value = slot.startTime;
  elements.slotEndTime.value = slot.endTime;
  elements.slotFormTitle.textContent = `编辑 ${slot.name}`;
  elements.cancelSlotEdit.hidden = false;
  elements.submitSlotButton.textContent = "保存修改";
  elements.slotName.focus();
}

function renderSlotSettingsList(): void {
  if (!lessonSlots.length) {
    const empty = document.createElement("p");
    empty.className = "slot-settings-empty";
    empty.textContent = "还没有节次，请在下方添加。";
    setDatabaseBinding(empty, "slots");
    elements.slotList.replaceChildren(empty);
    return;
  }

  const items = lessonSlots.map((slot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slot-setting-item${slot.id === editingSlotId ? " active" : ""}`;
    const order = document.createElement("span");
    order.className = "slot-setting-order";
    order.textContent = String(slot.order);
    const text = document.createElement("span");
    text.className = "slot-setting-text";
    const name = document.createElement("strong");
    name.textContent = slot.name;
    const time = document.createElement("small");
    time.textContent = slotTime(slot);
    text.append(name, time);
    const action = document.createElement("span");
    action.className = "slot-setting-action";
    action.textContent = "编辑";
    button.append(order, text, action);
    setDatabaseBinding(button, "slots");
    button.addEventListener("click", () => {
      editSlot(slot);
      renderSlotSettingsList();
    });
    return button;
  });
  elements.slotList.replaceChildren(...items);
}

function openSlotSettings(): void {
  if (!scheduleReady || elements.slotDialog.open) return;
  hideNotice();
  resetSlotEditor();
  renderSlotSettingsList();
  elements.slotDialog.showModal();
  window.requestAnimationFrame(() => elements.slotName.focus());
}

function closeSlotSettings(): void {
  if (slotSubmitting || !elements.slotDialog.open) return;
  elements.slotDialog.close();
  editingSlotId = null;
  elements.slotSettingsButton.focus();
}

function slotFormValues(): {
  name: string;
  order: number;
  startTime: string;
  endTime: string;
} | null {
  const name = elements.slotName.value.trim();
  const order = Number(elements.slotOrder.value);
  const startTime = elements.slotStartTime.value;
  const endTime = elements.slotEndTime.value;
  elements.slotName.setCustomValidity(name ? "" : "请输入节次名称");
  elements.slotOrder.setCustomValidity(Number.isInteger(order) && order > 0 ? "" : "请输入大于 0 的整数");
  elements.slotEndTime.setCustomValidity(
    startTime && endTime && endTime <= startTime ? "结束时间必须晚于开始时间" : "",
  );
  if (!elements.slotForm.reportValidity()) return null;

  if (lessonSlots.some((slot) => slot.id !== editingSlotId && slot.order === order)) {
    showSlotFormError(`排序 ${order} 已被其他节次使用。`);
    return null;
  }
  return { name, order, startTime, endTime };
}

async function submitSlot(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (slotSubmitting) return;
  clearSlotFormError();
  const values = slotFormValues();
  if (!values) return;

  setSlotSubmitting(true);
  try {
    if (editingSlotId) {
      await window.__SMART_PAGE__.database.updateRecord({
        databaseId: "__PING_CLASS_DB_LESSON_SLOTS__",
        recordId: editingSlotId,
        properties: {
          "节次名称": { text: values.name },
          "排序": { number: values.order },
          "开始时间": { text: values.startTime },
          "结束时间": { text: values.endTime },
        },
      });
    } else {
      await window.__SMART_PAGE__.database.addRecord({
        databaseId: "__PING_CLASS_DB_LESSON_SLOTS__",
        properties: {
          "节次名称": { text: values.name },
          "排序": { number: values.order },
          "开始时间": { text: values.startTime },
          "结束时间": { text: values.endTime },
        },
      });
    }
    lessonSlots = parseSlots(await queryAllSlots());
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    showSlotFormError(`保存失败：${message}`);
    setSlotSubmitting(false);
    return;
  }

  const wasEditing = Boolean(editingSlotId);
  setSlotSubmitting(false);
  resetSlotEditor();
  renderSlotSettingsList();
  renderSlotOptions();
  renderSchedule();
  updateControls();
  showNotice(wasEditing ? "节次已更新。" : "节次已添加。", "success");
}

async function refreshClasses(): Promise<void> {
  scheduleClasses = parseClasses(await queryAllScheduleClasses());
  renderClassOptions();
  renderSchedule();
  updateControls();
}

async function loadScheduleData(): Promise<void> {
  if (!window.__SMART_PAGE__?.database) {
    renderScheduleError("WorkBuddy Database SDK 未注入");
    return;
  }

  renderScheduleLoading();
  try {
    const [slotSchema, timetableSchema, slotRows, entryRows, classRows] = await Promise.all([
      window.__SMART_PAGE__.database.getSchema({
        databaseId: "__PING_CLASS_DB_LESSON_SLOTS__",
      }),
      window.__SMART_PAGE__.database.getSchema({
        databaseId: "__PING_CLASS_DB_WEEKLY_TIMETABLE__",
      }),
      queryAllSlots(),
      queryAllWeeklyEntries(),
      queryAllScheduleClasses(),
    ]);
    validateSchema(slotSchema, "节次配置表", [
      { name: "节次名称", type: "text" },
      { name: "排序", type: "number" },
      { name: "开始时间", type: "text" },
      { name: "结束时间", type: "text" },
    ]);
    validateSchema(timetableSchema, "周课表表", [
      { name: "星期", type: "number" },
      { name: "节次配置ID", type: "text" },
      { name: "班级ID", type: "text" },
      { name: "班级名称", type: "text" },
    ]);
    lessonSlots = parseSlots(slotRows);
    weeklyEntries = parseWeeklyEntries(entryRows);
    scheduleClasses = parseClasses(classRows);
    scheduleReady = true;
    renderSlotOptions();
    renderClassOptions();
    renderSchedule();
    updateControls();
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    renderScheduleError(`数据加载失败：${message}`);
    showNotice(`课表管理暂不可用：${message}`, "error");
  }
}

function registerScheduleEvents(): void {
  renderWeekdayOptions();
  elements.addButton.addEventListener("click", () => openCreateScheduleDialog());
  elements.slotSettingsButton.addEventListener("click", openSlotSettings);
  elements.todayButton.addEventListener("click", () => {
    selectedDate = atStartOfDay(new Date());
    visibleWeekStart = getWeekStart(selectedDate);
    renderSchedule();
  });
  elements.prevButton.addEventListener("click", () => {
    visibleWeekStart = addDays(visibleWeekStart, -7);
    selectedDate = addDays(selectedDate, -7);
    renderSchedule();
  });
  elements.nextButton.addEventListener("click", () => {
    visibleWeekStart = addDays(visibleWeekStart, 7);
    selectedDate = addDays(selectedDate, 7);
    renderSchedule();
  });

  elements.form.addEventListener("submit", (event) => void submitSchedule(event));
  elements.form.addEventListener("input", () => {
    clearScheduleFormError();
    scheduleDraftSave();
  });
  elements.form.addEventListener("change", scheduleDraftSave);
  elements.closeDialog.addEventListener("click", closeScheduleDialog);
  elements.cancelDialog.addEventListener("click", closeScheduleDialog);
  elements.deleteButton.addEventListener("click", () => void deleteSchedule());
  elements.dialog.addEventListener("cancel", (event) => {
    if (scheduleSubmitting) event.preventDefault();
  });
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) closeScheduleDialog();
  });

  elements.slotForm.addEventListener("submit", (event) => void submitSlot(event));
  elements.slotForm.addEventListener("input", clearSlotFormError);
  elements.closeSlotDialog.addEventListener("click", closeSlotSettings);
  elements.cancelSlotEdit.addEventListener("click", () => {
    resetSlotEditor();
    renderSlotSettingsList();
  });
  elements.slotDialog.addEventListener("cancel", (event) => {
    if (slotSubmitting) event.preventDefault();
  });
  elements.slotDialog.addEventListener("click", (event) => {
    if (event.target === elements.slotDialog) closeSlotSettings();
  });

  window.addEventListener("ping-class:classes-updated", () => {
    void refreshClasses().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "未知错误";
      showNotice(`班级已更新，但课表班级列表刷新失败：${message}`, "error");
    });
  });
}

export async function startSchedule(): Promise<void> {
  registerScheduleEvents();
  await loadScheduleData();
}

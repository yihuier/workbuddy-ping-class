import type { DatabaseRecord, DatabaseSchema } from "./workbuddy";

const CLASS_DATABASE_ID = "__PING_CLASS_DB_CLASSES__";
const STUDENT_DATABASE_ID = "__PING_CLASS_DB_STUDENTS__";
const GRADE_DATABASE_ID = "__PING_CLASS_DB_GRADES__";
const STUDENT_BINDING_ATTRIBUTES = {
  "data-sp-bindable": "database",
  "data-sp-database-id": STUDENT_DATABASE_ID,
};
const CLASS_BINDING_ATTRIBUTES = {
  "data-sp-bindable": "database",
  "data-sp-database-id": CLASS_DATABASE_ID,
};
const GRADE_BINDING_ATTRIBUTES = {
  "data-sp-bindable": "database",
  "data-sp-database-id": GRADE_DATABASE_ID,
};
const CLASS_FORM_DRAFT_KEY = "ping-class:add-class-draft:v2";

interface ClassFormDraft {
  className: string;
  gradeId: string;
  note: string;
}

interface GradeOption {
  id: string;
  name: string;
  order: number;
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`页面缺少必要元素: ${selector}`);
  return element;
}

const elements = {
  navItems: [...document.querySelectorAll<HTMLButtonElement>(".nav-item")],
  pages: [...document.querySelectorAll<HTMLElement>(".page")],
  today: requiredElement<HTMLSpanElement>("#today"),
  runtimeMode: requiredElement<HTMLSpanElement>("#runtime-mode"),
  chips: requiredElement<HTMLDivElement>("#filter-chips"),
  tableBody: requiredElement<HTMLTableSectionElement>("#stu-tbody"),
  count: requiredElement<HTMLSpanElement>("#result-count"),
  empty: requiredElement<HTMLDivElement>("#empty-state"),
  footer: requiredElement<HTMLSpanElement>("#footer-info"),
  search: requiredElement<HTMLInputElement>("#search-input"),
  addClassButton: requiredElement<HTMLButtonElement>("#add-class-button"),
  classDialog: requiredElement<HTMLDialogElement>("#add-class-dialog"),
  classForm: requiredElement<HTMLFormElement>("#add-class-form"),
  className: requiredElement<HTMLInputElement>('[name="className"]'),
  gradeCombobox: requiredElement<HTMLDivElement>("#class-grade-combobox"),
  gradeTrigger: requiredElement<HTMLButtonElement>("#class-grade-trigger"),
  gradeValue: requiredElement<HTMLSpanElement>("#class-grade-value"),
  gradeListbox: requiredElement<HTMLDivElement>("#class-grade-listbox"),
  note: requiredElement<HTMLTextAreaElement>('[name="note"]'),
  classFormStatus: requiredElement<HTMLParagraphElement>("#class-form-status"),
  closeClassDialog: requiredElement<HTMLButtonElement>("#close-class-dialog"),
  cancelAddClass: requiredElement<HTMLButtonElement>("#cancel-add-class"),
  submitAddClass: requiredElement<HTMLButtonElement>("#submit-add-class"),
  classNotice: requiredElement<HTMLDivElement>("#class-notice"),
};

let allStudents: DatabaseRecord[] = [];
let classNames: string[] = [];
let registeredClassNames: string[] = [];
let activeClass = "全部";
let searchText = "";
let gradeOptions: GradeOption[] = [];
let selectedGradeId = "";
let activeGradeIndex = -1;
let gradeComboboxOpen = false;
let classFormSubmitting = false;
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
  return typeof value === "number" && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function valueAsBoolean(record: DatabaseRecord, fieldName: string): boolean {
  return record[fieldName] === true;
}

function setDatabaseBinding(element: HTMLElement, databaseId: "class" | "student" | "grade"): void {
  const attributes =
    databaseId === "class"
      ? CLASS_BINDING_ATTRIBUTES
      : databaseId === "student"
        ? STUDENT_BINDING_ATTRIBUTES
        : GRADE_BINDING_ATTRIBUTES;
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
}

function showClassNotice(message: string, type: "success" | "error"): void {
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
  elements.classNotice.textContent = message;
  elements.classNotice.className = `inline-notice ${type}`;
  elements.classNotice.hidden = false;
  if (type === "success") {
    noticeTimer = window.setTimeout(() => {
      elements.classNotice.hidden = true;
      noticeTimer = undefined;
    }, 5000);
  }
}

function hideClassNotice(): void {
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
  noticeTimer = undefined;
  elements.classNotice.hidden = true;
}

function registerNavigation(): void {
  elements.navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const pageName = item.dataset.page;
      elements.navItems.forEach((navItem) => {
        const active = navItem === item;
        navItem.classList.toggle("active", active);
        navItem.setAttribute("aria-selected", String(active));
      });
      elements.pages.forEach((page) => page.classList.toggle("active", page.id === `page-${pageName}`));
    });
  });
}

function renderToday(): void {
  const date = new Date();
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  elements.today.textContent = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${weekday}`;
}

function renderRuntimeMode(): void {
  const isMock = import.meta.env.DEV && window.__PING_CLASS_MOCK_DATABASE__ === true;
  elements.runtimeMode.textContent = isMock ? "本地 Mock 数据" : "WorkBuddy 实时数据";
  elements.runtimeMode.dataset.mode = isMock ? "mock" : "online";
}

function appendHighlightedText(element: HTMLElement, text: string, keyword: string): void {
  if (!keyword) {
    element.textContent = text;
    return;
  }
  const index = text.indexOf(keyword);
  if (index < 0) {
    element.textContent = text;
    return;
  }
  const mark = document.createElement("mark");
  mark.className = "mark";
  mark.textContent = keyword;
  element.append(text.slice(0, index), mark, text.slice(index + keyword.length));
}

function classIndex(name: string): number {
  const index = classNames.indexOf(name);
  return index < 0 ? 3 : index % 4;
}

function renderChips(): void {
  const counts: Record<string, number> = { 全部: allStudents.length };
  allStudents.forEach((student) => {
    const className = valueAsText(student, "所属班级") || "未分班";
    counts[className] = (counts[className] ?? 0) + 1;
  });

  const chips = ["全部", ...classNames].map((className) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `chip${className === activeClass ? " active" : ""}`;
    chip.setAttribute("aria-pressed", String(className === activeClass));

    const label = document.createElement("span");
    label.textContent = className;
    setDatabaseBinding(label, className === "全部" ? "student" : "class");

    const count = document.createElement("span");
    count.className = "chip-count";
    count.textContent = String(counts[className] ?? 0);
    setDatabaseBinding(count, "student");

    chip.append(label, count);
    chip.addEventListener("click", () => {
      activeClass = className;
      renderChips();
      renderTable();
    });
    return chip;
  });
  elements.chips.replaceChildren(...chips);
}

function filteredStudents(): DatabaseRecord[] {
  const keyword = searchText.trim();
  return allStudents.filter((student) => {
    const className = valueAsText(student, "所属班级") || "未分班";
    if (activeClass !== "全部" && className !== activeClass) return false;
    if (!keyword) return true;
    return (
      valueAsText(student, "姓名").includes(keyword) ||
      valueAsText(student, "学号").includes(keyword)
    );
  });
}

function createStudentRow(student: DatabaseRecord, keyword: string): HTMLTableRowElement {
  const row = document.createElement("tr");

  const classCell = document.createElement("td");
  const classBadge = document.createElement("span");
  const className = valueAsText(student, "所属班级") || "未分班";
  classBadge.className = `cls-badge cls-${classIndex(className)}`;
  classBadge.textContent = className;
  setDatabaseBinding(classBadge, "student");
  classCell.append(classBadge);

  const numberCell = document.createElement("td");
  numberCell.className = "stu-no-cell";
  appendHighlightedText(numberCell, valueAsText(student, "学号"), keyword);
  setDatabaseBinding(numberCell, "student");

  const nameCell = document.createElement("td");
  appendHighlightedText(nameCell, valueAsText(student, "姓名"), keyword);
  setDatabaseBinding(nameCell, "student");

  const noteCell = document.createElement("td");
  noteCell.className = "stu-note-cell";
  noteCell.textContent = valueAsText(student, "备注");
  setDatabaseBinding(noteCell, "student");

  row.append(classCell, numberCell, nameCell, noteCell);
  return row;
}

function renderTable(): void {
  const keyword = searchText.trim();
  const students = filteredStudents();
  elements.count.textContent = `${students.length} 条记录`;
  elements.footer.textContent = `共 ${allStudents.length} 名学生 · 当前显示 ${students.length} 人`;

  if (!students.length) {
    elements.tableBody.replaceChildren();
    elements.empty.hidden = false;
    elements.empty.textContent = keyword
      ? `没有找到与「${keyword}」匹配的学生`
      : activeClass === "全部"
        ? "当前暂无学生"
        : `${activeClass} 暂无学生`;
    setDatabaseBinding(elements.empty, activeClass === "全部" ? "student" : "class");
    return;
  }

  elements.empty.hidden = true;
  elements.tableBody.replaceChildren(...students.map((student) => createStudentRow(student, keyword)));
}

function showLoading(): void {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.className = "table-loading";
  cell.textContent = "正在加载学生数据…";
  setDatabaseBinding(cell, "student");
  row.append(cell);
  elements.tableBody.replaceChildren(row);
  elements.empty.hidden = true;
}

function showError(message: string): void {
  elements.tableBody.replaceChildren();
  elements.empty.hidden = false;
  elements.empty.textContent = message;
  elements.count.textContent = "";
  elements.footer.textContent = "";
}

async function queryAllClasses(): Promise<DatabaseRecord[]> {
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

async function queryAllGrades(): Promise<DatabaseRecord[]> {
  const rows: DatabaseRecord[] = [];
  let startCursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const result = await window.__SMART_PAGE__.database.query({
      databaseId: "__PING_CLASS_DB_GRADES__",
      pageSize: 100,
      startCursor,
      sorts: [{ property: "排序", direction: "ascending" }],
    });
    rows.push(...result.results);
    hasMore = result.hasMore;
    startCursor = result.nextCursor ?? undefined;
    if (hasMore && !startCursor) throw new Error("年级配置表分页游标缺失");
  }
  return rows;
}

async function queryAllStudents(): Promise<DatabaseRecord[]> {
  const rows: DatabaseRecord[] = [];
  let startCursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const result = await window.__SMART_PAGE__.database.query({
      databaseId: "__PING_CLASS_DB_STUDENTS__",
      pageSize: 100,
      startCursor,
      sorts: [{ property: "学号", direction: "ascending" }],
    });
    rows.push(...result.results);
    hasMore = result.hasMore;
    startCursor = result.nextCursor ?? undefined;
    if (hasMore && !startCursor) throw new Error("学生表分页游标缺失");
  }
  return rows;
}

function updateClassNames(classRows: DatabaseRecord[]): void {
  registeredClassNames = [
    ...new Set(
      classRows
        .map((classRow) => valueAsText(classRow, "班级名称").trim())
        .filter((className) => Boolean(className)),
    ),
  ];
  const names = [...registeredClassNames];

  allStudents.forEach((student) => {
    const className = valueAsText(student, "所属班级").trim();
    if (className) names.push(className);
  });

  classNames = [...new Set(names)];
  if (activeClass !== "全部" && !classNames.includes(activeClass)) activeClass = "全部";
}

function getClassFormDraft(): ClassFormDraft | null {
  try {
    const rawDraft = localStorage.getItem(CLASS_FORM_DRAFT_KEY);
    if (!rawDraft) return null;
    const draft = JSON.parse(rawDraft) as Partial<ClassFormDraft>;
    return {
      className: typeof draft.className === "string" ? draft.className : "",
      gradeId: typeof draft.gradeId === "string" ? draft.gradeId : "",
      note: typeof draft.note === "string" ? draft.note : "",
    };
  } catch {
    return null;
  }
}

function saveClassFormDraft(): void {
  const draft: ClassFormDraft = {
    className: elements.className.value,
    gradeId: selectedGradeId,
    note: elements.note.value,
  };
  try {
    localStorage.setItem(CLASS_FORM_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 浏览器禁用 storage 时静默降级，不阻止班级写入。
  }
}

function scheduleClassFormDraftSave(): void {
  if (draftSaveTimer !== undefined) window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(() => {
    saveClassFormDraft();
    draftSaveTimer = undefined;
  }, 300);
}

function clearClassFormDraft(): void {
  if (draftSaveTimer !== undefined) window.clearTimeout(draftSaveTimer);
  draftSaveTimer = undefined;
  try {
    localStorage.removeItem(CLASS_FORM_DRAFT_KEY);
  } catch {
    // 浏览器禁用 storage 时无需额外处理。
  }
}

function restoreClassFormDraft(): void {
  const draft = getClassFormDraft();
  if (!draft) return;
  elements.className.value = draft.className;
  elements.note.value = draft.note;
  selectGrade(gradeOptions.some((option) => option.id === draft.gradeId) ? draft.gradeId : "");
}

function gradeOptionElements(): HTMLButtonElement[] {
  return [...elements.gradeListbox.querySelectorAll<HTMLButtonElement>(".grade-combobox-option")];
}

function setActiveGradeIndex(index: number, scrollIntoView = true): void {
  if (!gradeOptions.length) {
    activeGradeIndex = -1;
    elements.gradeTrigger.removeAttribute("aria-activedescendant");
    return;
  }
  activeGradeIndex = Math.max(0, Math.min(index, gradeOptions.length - 1));
  const optionElements = gradeOptionElements();
  optionElements.forEach((optionElement, optionIndex) => {
    optionElement.classList.toggle("active", optionIndex === activeGradeIndex);
  });
  const activeElement = optionElements[activeGradeIndex];
  if (!activeElement) return;
  elements.gradeTrigger.setAttribute("aria-activedescendant", activeElement.id);
  if (scrollIntoView && gradeComboboxOpen) activeElement.scrollIntoView({ block: "nearest" });
}

function selectGrade(gradeId: string): void {
  const option = gradeOptions.find((item) => item.id === gradeId);
  selectedGradeId = option?.id ?? "";
  elements.gradeValue.textContent = option?.name ?? "请选择年级";
  elements.gradeValue.classList.toggle("placeholder", !option);
  elements.gradeTrigger.setAttribute("aria-invalid", "false");
  elements.gradeCombobox.classList.remove("invalid");
  gradeOptionElements().forEach((optionElement, index) => {
    optionElement.setAttribute("aria-selected", String(gradeOptions[index]?.id === selectedGradeId));
  });
}

function openGradeCombobox(preferredIndex?: number): void {
  if (elements.gradeTrigger.disabled || !gradeOptions.length) return;
  gradeComboboxOpen = true;
  elements.gradeCombobox.classList.add("open");
  elements.gradeListbox.hidden = false;
  elements.gradeTrigger.setAttribute("aria-expanded", "true");
  const selectedIndex = gradeOptions.findIndex((option) => option.id === selectedGradeId);
  setActiveGradeIndex(preferredIndex ?? (selectedIndex >= 0 ? selectedIndex : 0));
}

function closeGradeCombobox(restoreFocus = false): void {
  if (!gradeComboboxOpen) return;
  gradeComboboxOpen = false;
  elements.gradeCombobox.classList.remove("open");
  elements.gradeListbox.hidden = true;
  elements.gradeTrigger.setAttribute("aria-expanded", "false");
  elements.gradeTrigger.removeAttribute("aria-activedescendant");
  if (restoreFocus) elements.gradeTrigger.focus();
}

function chooseActiveGrade(): void {
  const option = gradeOptions[activeGradeIndex];
  if (!option) return;
  selectGrade(option.id);
  clearClassFormError();
  scheduleClassFormDraftSave();
  closeGradeCombobox(true);
}

function moveActiveGrade(offset: number): void {
  if (!gradeComboboxOpen) {
    const selectedIndex = gradeOptions.findIndex((option) => option.id === selectedGradeId);
    const baseIndex = selectedIndex >= 0 ? selectedIndex : offset > 0 ? -1 : 0;
    openGradeCombobox((baseIndex + offset + gradeOptions.length) % gradeOptions.length);
    return;
  }
  setActiveGradeIndex((activeGradeIndex + offset + gradeOptions.length) % gradeOptions.length);
}

function renderGradeOptions(options: GradeOption[]): void {
  const optionElements = options.map((option, index) => {
    const optionElement = document.createElement("button");
    optionElement.id = `class-grade-option-${index + 1}`;
    optionElement.type = "button";
    optionElement.className = "grade-combobox-option";
    optionElement.setAttribute("role", "option");
    optionElement.setAttribute("aria-selected", "false");
    optionElement.tabIndex = -1;
    setDatabaseBinding(optionElement, "grade");

    const label = document.createElement("span");
    label.textContent = option.name;
    const selectedMark = document.createElement("span");
    selectedMark.className = "grade-combobox-check";
    selectedMark.textContent = "✓";
    selectedMark.setAttribute("aria-hidden", "true");
    optionElement.append(label, selectedMark);
    optionElement.addEventListener("pointerenter", () => setActiveGradeIndex(index, false));
    optionElement.addEventListener("click", () => {
      selectGrade(option.id);
      clearClassFormError();
      scheduleClassFormDraftSave();
      closeGradeCombobox(true);
    });
    return optionElement;
  });
  elements.gradeListbox.replaceChildren(...optionElements);
  selectGrade("");
}

function validateClassSchema(schema: DatabaseSchema): void {
  const expectedFields = [
    { name: "班级名称", type: "text" },
    { name: "年级配置ID", type: "text" },
    { name: "年级名称", type: "text" },
    { name: "备注", type: "text" },
  ];
  const invalidField = expectedFields.find(({ name, type }) => {
    const field = schema.properties.find((property) => property.name === name);
    return !field || field.type !== type;
  });
  if (invalidField) throw new Error(`班级表缺少有效的「${invalidField.name}」字段`);
}

function validateGradeSchema(schema: DatabaseSchema): void {
  const expectedFields = [
    { name: "年级名称", type: "text" },
    { name: "排序", type: "number" },
    { name: "新增班级时展示", type: "checkbox" },
    { name: "备注", type: "text" },
  ];
  const invalidField = expectedFields.find(({ name, type }) => {
    const field = schema.properties.find((property) => property.name === name);
    return !field || field.type !== type;
  });
  if (invalidField) throw new Error(`年级配置表缺少有效的「${invalidField.name}」字段`);
}

function createGradeOptions(rows: DatabaseRecord[]): GradeOption[] {
  return rows
    .filter((row) => valueAsBoolean(row, "新增班级时展示"))
    .map((row) => ({
      id: row._id,
      name: valueAsText(row, "年级名称").trim(),
      order: valueAsNumber(row, "排序"),
    }))
    .filter((option) => Boolean(option.name))
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "zh-CN"));
}

async function loadClassFormData(): Promise<void> {
  if (!window.__SMART_PAGE__?.database) return;
  elements.addClassButton.disabled = true;
  elements.gradeTrigger.disabled = true;
  try {
    const [classSchema, gradeSchema, gradeRows] = await Promise.all([
      window.__SMART_PAGE__.database.getSchema({
        databaseId: "__PING_CLASS_DB_CLASSES__",
      }),
      window.__SMART_PAGE__.database.getSchema({
        databaseId: "__PING_CLASS_DB_GRADES__",
      }),
      queryAllGrades(),
    ]);
    validateClassSchema(classSchema);
    validateGradeSchema(gradeSchema);
    gradeOptions = createGradeOptions(gradeRows);
    if (!gradeOptions.length) {
      throw new Error("年级配置表中没有开启“新增班级时展示”的年级");
    }
    renderGradeOptions(gradeOptions);
    restoreClassFormDraft();
    elements.gradeTrigger.disabled = false;
    elements.addClassButton.disabled = false;
    elements.addClassButton.removeAttribute("title");
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    elements.gradeValue.textContent = "暂无可用年级";
    elements.gradeValue.classList.add("placeholder");
    elements.addClassButton.title = "班级表或年级配置表加载失败";
    showClassNotice(`新增班级暂不可用：${message}`, "error");
  }
}

function showClassFormError(message: string): void {
  elements.classFormStatus.textContent = message;
  elements.classFormStatus.hidden = false;
}

function clearClassFormError(): void {
  elements.classFormStatus.hidden = true;
  elements.classFormStatus.textContent = "";
}

function setClassFormSubmitting(submitting: boolean): void {
  classFormSubmitting = submitting;
  if (submitting) closeGradeCombobox();
  elements.className.disabled = submitting;
  elements.gradeTrigger.disabled = submitting || !gradeOptions.length;
  elements.note.disabled = submitting;
  elements.closeClassDialog.disabled = submitting;
  elements.cancelAddClass.disabled = submitting;
  elements.submitAddClass.disabled = submitting;
  elements.submitAddClass.textContent = submitting ? "正在添加…" : "确认添加";
}

function openClassDialog(): void {
  if (elements.addClassButton.disabled || elements.classDialog.open) return;
  hideClassNotice();
  clearClassFormError();
  elements.className.setCustomValidity("");
  elements.classDialog.showModal();
  window.requestAnimationFrame(() => elements.className.focus());
}

function closeClassDialog(): void {
  if (classFormSubmitting || !elements.classDialog.open) return;
  closeGradeCombobox();
  elements.classDialog.close();
  elements.addClassButton.focus();
}

function validateClassForm(): { className: string; grade: GradeOption; note: string } | null {
  const className = elements.className.value.trim();
  const grade = gradeOptions.find((option) => option.id === selectedGradeId);
  const note = elements.note.value.trim();
  elements.className.setCustomValidity("");

  if (!className) {
    elements.className.setCustomValidity("请输入班级名称");
  } else if (registeredClassNames.some((existingName) => existingName === className)) {
    elements.className.setCustomValidity("该班级已经存在");
  }

  if (!elements.classForm.reportValidity()) return null;
  if (!grade) {
    elements.gradeTrigger.setAttribute("aria-invalid", "true");
    elements.gradeCombobox.classList.add("invalid");
    showClassFormError("请选择年级");
    elements.gradeTrigger.focus();
    return null;
  }
  return { className, grade, note };
}

async function submitClassForm(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (classFormSubmitting) return;
  clearClassFormError();

  const values = validateClassForm();
  if (!values) return;
  if (!window.__SMART_PAGE__?.database) {
    showClassFormError("WorkBuddy Database SDK 未注入，无法添加班级。");
    return;
  }

  setClassFormSubmitting(true);
  try {
    await window.__SMART_PAGE__.database.addRecord({
      databaseId: "__PING_CLASS_DB_CLASSES__",
      properties: {
        "班级名称": { text: values.className },
        "年级配置ID": { text: values.grade.id },
        "年级名称": { text: values.grade.name },
        "备注": { text: values.note },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    showClassFormError(`添加失败：${message}`);
    setClassFormSubmitting(false);
    return;
  }

  clearClassFormDraft();
  elements.classForm.reset();
  selectGrade("");
  elements.classDialog.close();
  setClassFormSubmitting(false);
  elements.addClassButton.focus();

  try {
    const classRows = await queryAllClasses();
    updateClassNames(classRows);
    window.dispatchEvent(new Event("ping-class:classes-updated"));
    activeClass = values.className;
    renderChips();
    renderTable();
    showClassNotice(`班级「${values.className}」已添加。`, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    showClassNotice(`班级「${values.className}」已添加，但列表刷新失败：${message}`, "error");
  }
}

function registerClassForm(): void {
  elements.addClassButton.addEventListener("click", openClassDialog);
  elements.closeClassDialog.addEventListener("click", closeClassDialog);
  elements.cancelAddClass.addEventListener("click", closeClassDialog);
  elements.classForm.addEventListener("submit", (event) => void submitClassForm(event));
  elements.classForm.addEventListener("input", () => {
    elements.className.setCustomValidity("");
    clearClassFormError();
    scheduleClassFormDraftSave();
  });
  elements.classForm.addEventListener("change", scheduleClassFormDraftSave);
  elements.gradeTrigger.addEventListener("click", () => {
    if (gradeComboboxOpen) closeGradeCombobox();
    else openGradeCombobox();
  });
  elements.gradeTrigger.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActiveGrade(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActiveGrade(-1);
        break;
      case "Home":
        if (!gradeComboboxOpen) return;
        event.preventDefault();
        setActiveGradeIndex(0);
        break;
      case "End":
        if (!gradeComboboxOpen) return;
        event.preventDefault();
        setActiveGradeIndex(gradeOptions.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (gradeComboboxOpen) chooseActiveGrade();
        else openGradeCombobox();
        break;
      case "Escape":
        if (!gradeComboboxOpen) return;
        event.preventDefault();
        closeGradeCombobox();
        break;
      case "Tab":
        closeGradeCombobox();
        break;
      default:
        break;
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && !elements.gradeCombobox.contains(event.target)) {
      closeGradeCombobox();
    }
  });
  elements.classDialog.addEventListener("cancel", (event) => {
    if (classFormSubmitting) event.preventDefault();
    else closeGradeCombobox();
  });
  elements.classDialog.addEventListener("click", (event) => {
    if (event.target === elements.classDialog) closeClassDialog();
  });
  elements.classDialog.addEventListener("close", () => closeGradeCombobox());
}

async function loadClassData(): Promise<void> {
  if (!window.__SMART_PAGE__?.database) {
    showError("WorkBuddy Database SDK 未注入");
    return;
  }

  showLoading();
  try {
    const [classRows, studentRows] = await Promise.all([queryAllClasses(), queryAllStudents()]);
    allStudents = studentRows;
    updateClassNames(classRows);
    renderChips();
    renderTable();
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    showError(`数据加载失败：${message}`);
  }
}

export async function startApplication(): Promise<void> {
  registerNavigation();
  registerClassForm();
  renderToday();
  renderRuntimeMode();
  elements.search.addEventListener("input", () => {
    searchText = elements.search.value;
    renderTable();
  });
  await Promise.all([loadClassData(), loadClassFormData()]);
}

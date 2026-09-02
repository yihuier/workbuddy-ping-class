import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import {
  DATABASE_ID_RE,
  isObject,
  readJson,
  run,
  validateManifest,
} from "./lib/workbuddy-release.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const config = readJson(resolve(projectRoot, "workbuddy.config.json"), "workbuddy.config.json");
const manifest = validateManifest(readJson(resolve(projectRoot, config.manifest), config.manifest));
const textExtensions = new Set([
  "",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".py",
  ".ts",
  ".txt",
  ".yml",
  ".yaml",
]);

function fail(message) {
  process.stderr.write(`公开仓库检查失败：${message}\n`);
  process.exit(1);
}

try {
  const listed = run(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: projectRoot },
  ).stdout;
  const paths = listed.split("\0").filter(Boolean);
  const publicFiles = paths.filter((path) => {
    const absolutePath = resolve(projectRoot, path);
    return existsSync(absolutePath) && statSync(absolutePath).isFile();
  });
  const forbiddenTrackedPaths = publicFiles.filter(
    (path) =>
      path === "workbuddy.local.json" ||
      path === "AGENTS.local.md" ||
      path.startsWith(".private/"),
  );
  if (forbiddenTrackedPaths.length) {
    throw new Error(`本地私有文件进入公开集合：${forbiddenTrackedPaths.join(", ")}`);
  }

  const textFiles = publicFiles.filter((path) => textExtensions.has(extname(path).toLowerCase()));
  const contents = new Map(
    textFiles.map((path) => [path, readFileSync(resolve(projectRoot, path), "utf8")]),
  );
  const universalPatterns = [
    { label: "个人用户目录", pattern: /(?:\/Users\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[^\\]+\\)/ },
    { label: "私钥", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY/ },
    { label: "GitHub token", pattern: /(?:github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,})/ },
    { label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
    { label: "WorkBuddy token", pattern: /\bop_[A-Za-z0-9]{20,}\b/ },
  ];
  for (const [path, content] of contents) {
    for (const { label, pattern } of universalPatterns) {
      if (pattern.test(content)) throw new Error(`${path} 包含${label}`);
    }
  }

  const localMappingPath = resolve(projectRoot, config.localMapping);
  if (existsSync(localMappingPath)) {
    const rawLocalMapping = readJson(localMappingPath, config.localMapping);
    if (!isObject(rawLocalMapping)) {
      throw new Error(`${config.localMapping} 必须是 JSON 对象`);
    }
    if ("databaseBindings" in rawLocalMapping && !isObject(rawLocalMapping.databaseBindings)) {
      throw new Error(`${config.localMapping}.databaseBindings 必须是 JSON 对象`);
    }
    const localMapping = isObject(rawLocalMapping.databaseBindings)
      ? rawLocalMapping.databaseBindings
      : rawLocalMapping;
    for (const [alias, rawValue] of Object.entries(localMapping)) {
      const databaseId = isObject(rawValue) ? rawValue.id : rawValue;
      if (typeof databaseId !== "string" || !DATABASE_ID_RE.test(databaseId)) continue;
      const leakedFiles = [...contents]
        .filter(([, content]) => content.includes(databaseId))
        .map(([path]) => path);
      if (leakedFiles.length) {
        throw new Error(`本地 ${alias} databaseId 出现在公开文件：${leakedFiles.join(", ")}`);
      }
    }
  }

  const fixedCardinalityPattern = /[一二三四五六七八九十\d]+\s*(?:张\s*资料表|个\s*databaseId)/;
  for (const path of ["README.md", "AGENTS.md", "workbuddy/AGENT_INSTALL.md"]) {
    const content = contents.get(path) ?? "";
    if (fixedCardinalityPattern.test(content)) throw new Error(`${path} 仍含写死 binding 数量的表述`);
  }

  if (Array.isArray(config.databases) || "databaseIds" in config) {
    throw new Error("workbuddy.config.json 不得保存公开或本地 databaseId 清单");
  }
  if (!config.localMapping || config.localMapping !== "workbuddy.local.json") {
    throw new Error("workbuddy.config.json 必须使用已忽略的 workbuddy.local.json 作为本地映射");
  }

  const mockDataFiles = publicFiles.filter((path) => path.startsWith("public/mock/data/"));
  const aliases = new Set(Object.keys(manifest.databaseBindings));
  for (const path of mockDataFiles) {
    const alias = path.slice("public/mock/data/".length, -".json".length);
    if (!path.endsWith(".json") || !aliases.has(alias)) {
      throw new Error(`Mock 数据文件必须按 manifest alias 命名：${path}`);
    }
    const records = JSON.parse(contents.get(path) ?? "[]");
    if (!Array.isArray(records)) throw new Error(`${path} 顶层必须是数组`);
    for (const record of records) {
      if (!record || typeof record !== "object" || typeof record._id !== "string" || !record._id.startsWith("demo_")) {
        throw new Error(`${path} 只能包含 _id 以 demo_ 开头的明确演示记录`);
      }
    }
  }
  const studentsPath = "public/mock/data/students.json";
  if (contents.has(studentsPath)) {
    const students = JSON.parse(contents.get(studentsPath));
    if (students.length > 24) throw new Error("公开学生 Mock 不得超过 24 条");
    for (const student of students) {
      if (
        typeof student["姓名"] !== "string" ||
        !student["姓名"].startsWith("示例学生 ") ||
        typeof student["学号"] !== "string" ||
        !student["学号"].startsWith("DEMO-")
      ) {
        throw new Error("公开学生 Mock 必须使用明确的示例姓名和 DEMO 学号");
      }
    }
  }

  const gradesPath = "public/mock/data/grades.json";
  if (isObject(manifest.databaseBindings.grades)) {
    if (!contents.has(gradesPath)) {
      throw new Error(`缺少年级 Mock 数据：${gradesPath}`);
    }
    const gradeRecords = JSON.parse(contents.get(gradesPath));
    if (!Array.isArray(gradeRecords)) {
      throw new Error(`${gradesPath} 必须是 JSON 数组`);
    }
    const actualDefaults = gradeRecords.map((record) => ({
      name: record["年级名称"],
      order: record["排序"],
      visible: record["新增班级时展示"],
    }));
    const expectedDefaults = manifest.databaseBindings.grades.seedRecords.map((record) => ({
      name: record["年级名称"]?.text,
      order: record["排序"]?.number,
      visible: record["新增班级时展示"]?.checkbox,
    }));
    if (JSON.stringify(actualDefaults) !== JSON.stringify(expectedDefaults)) {
      throw new Error("年级 Mock 默认值必须与 manifest seedRecords 完全一致");
    }
  }

  process.stdout.write(
    `公开仓库检查通过（${publicFiles.length} 个文件，${Object.keys(manifest.databaseBindings).length} 个当前数据库绑定）\n`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : "未知错误");
}

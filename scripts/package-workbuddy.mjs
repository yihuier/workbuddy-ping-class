import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  MAX_HTML_BYTES,
  assertProjectPath,
  createMergedSchema,
  findWorkBuddySkillRoot,
  normalizeMapping,
  readJson,
  run,
  validateManifest,
} from "./lib/workbuddy-release.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;

function fail(message) {
  process.stderr.write(`WorkBuddy 个人包打包失败：${message}\n`);
  process.exit(1);
}

try {
  const config = readJson(resolve(projectRoot, "workbuddy.config.json"), "workbuddy.config.json");
  const sourceManifest = validateManifest(
    readJson(resolve(projectRoot, config.manifest), config.manifest),
  );
  const localMappingPath = assertProjectPath(projectRoot, config.localMapping, "localMapping");
  if (!existsSync(localMappingPath)) {
    throw new Error(
      `缺少本地映射 ${config.localMapping}；先运行 npm run setup:local，再填写自己的 databaseId`,
    );
  }
  const mapping = normalizeMapping(
    readJson(localMappingPath, config.localMapping),
    sourceManifest,
  );
  const placeholderValues = Object.entries(mapping)
    .filter(([, databaseId]) => /^(?:YOUR|REPLACE|EXAMPLE)_/i.test(databaseId))
    .map(([alias]) => alias);
  if (placeholderValues.length) {
    throw new Error(`本地映射尚未填写真实 databaseId：${placeholderValues.join(", ")}`);
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npmCommand, ["run", "package:agent"], { cwd: projectRoot, stdio: "inherit" });

  const releaseManifestPath = resolve(projectRoot, "release/workbuddy-manifest.json");
  const templatePath = resolve(projectRoot, "release/ping-class-template.html");
  const rendererPath = resolve(projectRoot, "release/render_workbuddy_template.py");
  const releaseManifest = validateManifest(
    readJson(releaseManifestPath, "release/workbuddy-manifest.json"),
  );
  if (releaseManifest.appId !== sourceManifest.appId || releaseManifest.version !== sourceManifest.version) {
    throw new Error("发行 manifest 与源码 manifest 身份或版本不一致");
  }

  const packagePath = assertProjectPath(projectRoot, config.packageOutput, "packageOutput");
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ping-class-personal-"));
  try {
    const mappingPath = resolve(temporaryDirectory, "database-map.json");
    const renderedPath = resolve(temporaryDirectory, "index.html");
    writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");
    run(
      "python3",
      [
        rendererPath,
        "--manifest",
        releaseManifestPath,
        "--template",
        templatePath,
        "--mapping",
        mappingPath,
        "--output",
        renderedPath,
      ],
      { cwd: projectRoot },
    );
    if (statSync(renderedPath).size > MAX_HTML_BYTES) throw new Error("渲染后的 HTML 超过 50 MiB");

    const skillRoot = findWorkBuddySkillRoot(sourceManifest);
    if (!skillRoot) {
      throw new Error("个人导入包必须经过官方校验；请设置 WORKBUDDY_SKILL_LIBRARY");
    }
    const lintScript = resolve(skillRoot, "page/lint_database_sdk_usage.py");
    const parseScript = resolve(skillRoot, "page/parse_html.py");
    if (!existsSync(lintScript) || !existsSync(parseScript)) {
      throw new Error(`WorkBuddy skill-library 缺少官方 lint 或解析器：${skillRoot}`);
    }
    const lint = run(
      "python3",
      [lintScript, "--schema", JSON.stringify(createMergedSchema(sourceManifest)), "--html", renderedPath],
      { cwd: projectRoot },
    );
    if (lint.stdout.trim()) process.stdout.write(`${lint.stdout.trim()}\n`);
    const parsed = run("python3", [parseScript, "--html", renderedPath], { cwd: projectRoot });
    let parseResult;
    try {
      parseResult = JSON.parse(parsed.stdout);
    } catch {
      throw new Error("parse_html.py 未返回合法 JSON");
    }
    const expectedIds = new Set(Object.values(mapping));
    const parsedIds = new Set((parseResult.existing_databases ?? []).map((database) => database.id));
    const missingIds = [...expectedIds].filter((databaseId) => !parsedIds.has(databaseId));
    const extraIds = [...parsedIds].filter((databaseId) => !expectedIds.has(databaseId));
    if (!parseResult.sdk_calls_found || missingIds.length || extraIds.length) {
      throw new Error(
        `官方解析器结果与本地映射不一致；缺少：${missingIds.join(", ") || "无"}；多出：${extraIds.join(", ") || "无"}`,
      );
    }

    mkdirSync(dirname(packagePath), { recursive: true });
    rmSync(packagePath, { force: true });
    run("python3", ["-m", "zipfile", "-c", packagePath, "index.html"], {
      cwd: temporaryDirectory,
    });
    const inspectScript = [
      "import json, sys, zipfile",
      "with zipfile.ZipFile(sys.argv[1]) as archive:",
      "    print(json.dumps({'entries': archive.namelist(), 'corrupt': archive.testzip()}))",
    ].join("\n");
    const inspection = run("python3", ["-c", inspectScript, packagePath], { cwd: projectRoot });
    const archiveInfo = JSON.parse(inspection.stdout);
    if (archiveInfo.corrupt) throw new Error(`ZIP 内文件损坏：${archiveInfo.corrupt}`);
    if (JSON.stringify(archiveInfo.entries) !== JSON.stringify(["index.html"])) {
      throw new Error(`ZIP 应只包含根目录 index.html，实际为：${archiveInfo.entries.join(", ")}`);
    }
    if (statSync(packagePath).size > MAX_PACKAGE_BYTES) throw new Error("ZIP 超过 50 MiB 上限");

    process.stdout.write(
      [
        "WorkBuddy 个人导入包已生成",
        `路径：${config.packageOutput}`,
        `版本：${sourceManifest.version}`,
        `数据库绑定：${expectedIds.size}`,
        `大小：${(statSync(packagePath).size / 1024).toFixed(1)} KiB`,
      ].join("\n") + "\n",
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
} catch (error) {
  fail(error instanceof Error ? error.message : "未知错误");
}

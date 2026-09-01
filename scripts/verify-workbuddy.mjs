import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  MAX_HTML_BYTES,
  bindingEntries,
  createMergedSchema,
  createTestMapping,
  findWorkBuddySkillRoot,
  readJson,
  run,
  sha256,
  validateManifest,
} from "./lib/workbuddy-release.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

function fail(message) {
  process.stderr.write(`WorkBuddy 验证失败：${message}\n`);
  process.exit(1);
}

try {
  const config = readJson(resolve(projectRoot, "workbuddy.config.json"), "workbuddy.config.json");
  const packageJson = readJson(resolve(projectRoot, "package.json"), "package.json");
  const manifest = validateManifest(
    readJson(resolve(projectRoot, config.manifest), config.manifest),
  );
  if (config.version !== 2) throw new Error("workbuddy.config.json version 必须为 2");
  if (manifest.version !== packageJson.version) {
    throw new Error(`manifest 版本 ${manifest.version} 与 package.json ${packageJson.version} 不一致`);
  }

  const htmlPath = resolve(projectRoot, config.entry);
  if (!existsSync(htmlPath)) throw new Error(`找不到构建产物 ${config.entry}`);
  const outputFiles = readdirSync(resolve(projectRoot, "dist"));
  if (outputFiles.length !== 1 || outputFiles[0] !== "index.html") {
    throw new Error(`dist 应只包含 index.html，实际为：${outputFiles.join(", ")}`);
  }

  const html = readFileSync(htmlPath, "utf8");
  if (!html.includes(`name="ping-class-version" content="${packageJson.version}"`)) {
    throw new Error("生产模板缺少与 package.json 一致的应用版本元数据");
  }
  if (statSync(htmlPath).size > MAX_HTML_BYTES) throw new Error("index.html 超过 WorkBuddy 50 MiB 上限");
  if (/\bmock\/|MockDB|__PING_CLASS_MOCK_DATABASE__/.test(html)) {
    throw new Error("生产模板仍包含本地 Mock 代码或资源");
  }
  if (/<script[^>]+src=|<link[^>]+rel=["']stylesheet["'][^>]+href=/.test(html)) {
    throw new Error("生产模板仍依赖外部 JS/CSS 文件");
  }
  if (/<img[^>]+(?:src|srcset)=["']https?:\/\/(?![^"']*(?:workbuddy|codebuddy))/i.test(html)) {
    throw new Error("生产模板存在未托管的第三方图片链接");
  }

  const expectedPlaceholders = new Set(
    bindingEntries(manifest).map(([, binding]) => binding.placeholder),
  );
  const foundPlaceholders = new Set(html.match(/__PING_CLASS_DB_[A-Z0-9_]+__/g) ?? []);
  const missingPlaceholders = [...expectedPlaceholders].filter((placeholder) => !foundPlaceholders.has(placeholder));
  const unknownPlaceholders = [...foundPlaceholders].filter((placeholder) => !expectedPlaceholders.has(placeholder));
  if (missingPlaceholders.length || unknownPlaceholders.length) {
    throw new Error(
      `模板 database placeholder 与 manifest 不一致；缺少：${missingPlaceholders.join(", ") || "无"}；未知：${unknownPlaceholders.join(", ") || "无"}`,
    );
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ping-class-verify-"));
  try {
    const templatePath = resolve(temporaryDirectory, "template.html");
    const manifestPath = resolve(temporaryDirectory, "manifest.json");
    const mappingPath = resolve(temporaryDirectory, "mapping.json");
    const renderedPath = resolve(temporaryDirectory, "rendered.html");
    const mapping = createTestMapping(manifest);
    const versionPlaceholder = manifest.page.appVersionPlaceholder;
    const template = html.replace(
      `name="ping-class-version" content="${manifest.version}"`,
      `name="ping-class-version" content="${versionPlaceholder}"`,
    );
    const testManifest = {
      ...manifest,
      assets: {
        template: {
          file: "template.html",
          sha256: sha256(Buffer.from(template, "utf8")),
          size: Buffer.byteLength(template, "utf8"),
        },
      },
    };
    writeFileSync(templatePath, template, "utf8");
    writeFileSync(manifestPath, `${JSON.stringify(testManifest, null, 2)}\n`, "utf8");
    writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");
    run(
      "python3",
      [
        resolve(projectRoot, "workbuddy/render_workbuddy_template.py"),
        "--manifest",
        manifestPath,
        "--template",
        templatePath,
        "--mapping",
        mappingPath,
        "--output",
        renderedPath,
      ],
      { cwd: projectRoot },
    );

    const renderedHtml = readFileSync(renderedPath, "utf8");
    if (/__PING_CLASS_[A-Z0-9_]+__/.test(renderedHtml)) {
      throw new Error("测试渲染结果仍含 Ping Class placeholder");
    }
    for (const [alias, databaseId] of Object.entries(mapping)) {
      if (!renderedHtml.includes(databaseId)) throw new Error(`测试渲染结果缺少 ${alias} databaseId`);
    }

    const skipOfficial =
      process.argv.includes("--portable") ||
      process.env.WORKBUDDY_PORTABLE_RELEASE === "1" ||
      process.env.WORKBUDDY_SKIP_OFFICIAL === "1";
    const requireOfficial =
      process.argv.includes("--require-official") || process.env.WORKBUDDY_REQUIRE_OFFICIAL === "1";
    const skillRoot = skipOfficial ? null : findWorkBuddySkillRoot(manifest);
    if (requireOfficial && !skillRoot) {
      throw new Error("未找到受支持的 WorkBuddy skill-library；请设置 WORKBUDDY_SKILL_LIBRARY");
    }
    if (skillRoot) {
      const lintScript = resolve(skillRoot, "page/lint_database_sdk_usage.py");
      const parseScript = resolve(skillRoot, "page/parse_html.py");
      if (!existsSync(lintScript) || !existsSync(parseScript)) {
        throw new Error(`WorkBuddy skill-library 缺少官方 lint 或解析器：${skillRoot}`);
      }
      const lint = run(
        "python3",
        [lintScript, "--schema", JSON.stringify(createMergedSchema(manifest)), "--html", renderedPath],
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
      const parsedIds = new Set((parseResult.existing_databases ?? []).map((database) => database.id));
      const expectedIds = new Set(Object.values(mapping));
      const missingIds = [...expectedIds].filter((databaseId) => !parsedIds.has(databaseId));
      const extraIds = [...parsedIds].filter((databaseId) => !expectedIds.has(databaseId));
      if (!parseResult.sdk_calls_found || missingIds.length || extraIds.length) {
        throw new Error(
          `官方解析器结果与 manifest 不一致；缺少：${missingIds.join(", ") || "无"}；多出：${extraIds.join(", ") || "无"}`,
        );
      }
      process.stdout.write(`WorkBuddy 官方 lint 与解析器已验证 ${expectedIds.size} 个数据库绑定\n`);
    } else {
      process.stdout.write("未发现本地 WorkBuddy skill-library，已完成便携结构验证\n");
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  process.stdout.write(`WorkBuddy 单文件模板验证通过（${expectedPlaceholders.size} 个数据库绑定）\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : "未知错误");
}

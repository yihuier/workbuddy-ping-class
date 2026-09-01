import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import {
  MAX_HTML_BYTES,
  bindingEntries,
  createTestMapping,
  readJson,
  run,
  sha256,
  validateManifest,
} from "./lib/workbuddy-release.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const releaseDirectory = resolve(projectRoot, "release");
const templateName = "ping-class-template.html";
const rendererName = "render_workbuddy_template.py";
const manifestName = "workbuddy-manifest.json";
const checksumsName = "SHA256SUMS";
const templatePath = resolve(releaseDirectory, templateName);
const rendererOutputPath = resolve(releaseDirectory, rendererName);
const manifestOutputPath = resolve(releaseDirectory, manifestName);
const checksumsPath = resolve(releaseDirectory, checksumsName);

function fail(message) {
  process.stderr.write(`Agent 发行打包失败：${message}\n`);
  process.exit(1);
}

try {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npmCommand, ["run", "build"], { cwd: projectRoot, stdio: "inherit" });

  const packageJson = readJson(resolve(projectRoot, "package.json"), "package.json");
  const config = readJson(resolve(projectRoot, "workbuddy.config.json"), "workbuddy.config.json");
  const manifest = validateManifest(
    readJson(resolve(projectRoot, config.manifest), config.manifest),
  );
  const stableChannel = readJson(resolve(projectRoot, "workbuddy/latest.json"), "workbuddy/latest.json");
  if (config.version !== 2) throw new Error("workbuddy.config.json version 必须为 2");
  if (manifest.version !== packageJson.version) {
    throw new Error(`manifest 版本 ${manifest.version} 与 package.json ${packageJson.version} 不一致`);
  }

  const expectedManifestUrl = `${manifest.repository}/releases/latest/download/${manifestName}`;
  const requiredHosts = [
    "github.com",
    "objects.githubusercontent.com",
    "raw.githubusercontent.com",
    "release-assets.githubusercontent.com",
  ];
  if (
    stableChannel.protocolVersion !== manifest.protocolVersion ||
    stableChannel.appId !== manifest.appId ||
    stableChannel.channel !== "stable" ||
    stableChannel.manifestUrl !== expectedManifestUrl ||
    !Array.isArray(stableChannel.allowedDownloadHosts) ||
    requiredHosts.some((host) => !stableChannel.allowedDownloadHosts.includes(host))
  ) {
    throw new Error("workbuddy/latest.json 与 manifest 或稳定发布地址不一致");
  }

  const entryPath = resolve(projectRoot, config.entry);
  const distFiles = readdirSync(resolve(projectRoot, "dist"));
  if (distFiles.length !== 1 || distFiles[0] !== "index.html") {
    throw new Error(`dist 应只包含 index.html，实际为：${distFiles.join(", ")}`);
  }
  if (statSync(entryPath).size > MAX_HTML_BYTES) throw new Error("构建模板超过 50 MiB");

  let template = readFileSync(entryPath, "utf8");
  const builtVersionMarker = `name="ping-class-version" content="${manifest.version}"`;
  const templateVersionMarker =
    `name="ping-class-version" content="${manifest.page.appVersionPlaceholder}"`;
  if (!template.includes(builtVersionMarker)) throw new Error("构建模板缺少应用版本元数据");
  template = template.replace(builtVersionMarker, templateVersionMarker);

  const expectedPlaceholders = new Set(
    bindingEntries(manifest).map(([, binding]) => binding.placeholder),
  );
  const foundPlaceholders = new Set(template.match(/__PING_CLASS_DB_[A-Z0-9_]+__/g) ?? []);
  const missingPlaceholders = [...expectedPlaceholders].filter((placeholder) => !foundPlaceholders.has(placeholder));
  const unknownPlaceholders = [...foundPlaceholders].filter((placeholder) => !expectedPlaceholders.has(placeholder));
  if (missingPlaceholders.length || unknownPlaceholders.length) {
    throw new Error(
      `发行模板 database placeholder 与 manifest 不一致；缺少：${missingPlaceholders.join(", ") || "无"}；未知：${unknownPlaceholders.join(", ") || "无"}`,
    );
  }
  if (/<script[^>]+src=|<link[^>]+rel=["']stylesheet["'][^>]+href=/.test(template)) {
    throw new Error("发行模板仍依赖外部 JS/CSS");
  }
  if (/<img[^>]+(?:src|srcset)=["']https?:\/\/(?![^"']*(?:workbuddy|codebuddy))/i.test(template)) {
    throw new Error("发行模板仍包含未托管的第三方图片链接");
  }

  mkdirSync(releaseDirectory, { recursive: true });
  for (const path of [templatePath, rendererOutputPath, manifestOutputPath, checksumsPath]) {
    rmSync(path, { force: true });
  }
  writeFileSync(templatePath, template, "utf8");
  copyFileSync(resolve(projectRoot, "workbuddy/render_workbuddy_template.py"), rendererOutputPath);

  const tag = `v${manifest.version}`;
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== tag) {
    throw new Error(`Git tag ${process.env.GITHUB_REF_NAME} 与应用版本 ${tag} 不一致`);
  }
  const releaseBaseUrl = `${manifest.repository}/releases/download/${tag}`;
  const templateBytes = readFileSync(templatePath);
  const rendererBytes = readFileSync(rendererOutputPath);
  const releaseManifest = {
    ...manifest,
    release: {
      tag,
      pageUrl: `${manifest.repository}/releases/tag/${tag}`,
    },
    assets: {
      template: {
        file: templateName,
        url: `${releaseBaseUrl}/${templateName}`,
        sha256: sha256(templateBytes),
        size: templateBytes.length,
      },
      renderer: {
        file: rendererName,
        url: `${releaseBaseUrl}/${rendererName}`,
        sha256: sha256(rendererBytes),
        size: rendererBytes.length,
        networkAccess: false,
      },
    },
  };
  writeFileSync(manifestOutputPath, `${JSON.stringify(releaseManifest, null, 2)}\n`, "utf8");

  const testMappingPath = resolve(releaseDirectory, ".agent-release-test-mapping.json");
  const testOutputPath = resolve(releaseDirectory, ".agent-release-test.html");
  const testMapping = createTestMapping(manifest);
  writeFileSync(testMappingPath, `${JSON.stringify(testMapping, null, 2)}\n`, "utf8");
  try {
    run(
      "python3",
      [
        rendererOutputPath,
        "--manifest",
        manifestOutputPath,
        "--template",
        templatePath,
        "--mapping",
        testMappingPath,
        "--output",
        testOutputPath,
      ],
      { cwd: projectRoot },
    );
    const renderedHtml = readFileSync(testOutputPath, "utf8");
    if (/__PING_CLASS_[A-Z0-9_]+__/.test(renderedHtml)) {
      throw new Error("测试渲染结果仍含 Ping Class placeholder");
    }
    for (const [alias, databaseId] of Object.entries(testMapping)) {
      if (!renderedHtml.includes(databaseId)) throw new Error(`测试渲染结果缺少 ${alias} databaseId`);
    }
  } finally {
    rmSync(testMappingPath, { force: true });
    rmSync(testOutputPath, { force: true });
  }

  const manifestBytes = readFileSync(manifestOutputPath);
  const checksumEntries = [
    [templateName, templateBytes],
    [rendererName, rendererBytes],
    [manifestName, manifestBytes],
  ];
  writeFileSync(
    checksumsPath,
    `${checksumEntries.map(([name, content]) => `${sha256(content)}  ${name}`).join("\n")}\n`,
    "utf8",
  );

  process.stdout.write(
    [
      "WorkBuddy Agent 发行产物已生成",
      `版本：${manifest.version}`,
      `数据库绑定：${expectedPlaceholders.size}`,
      `模板：release/${basename(templatePath)} (${templateBytes.length} bytes)`,
      `manifest：release/${basename(manifestOutputPath)}`,
      `渲染器：release/${basename(rendererOutputPath)}`,
      `校验和：release/${basename(checksumsPath)}`,
    ].join("\n") + "\n",
  );
} catch (error) {
  fail(error instanceof Error ? error.message : "未知错误");
}

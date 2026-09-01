import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  bindingEntries,
  createMergedSchema,
  normalizeMapping,
  run,
  sha256,
  validateManifest,
} from "./lib/workbuddy-release.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const rendererPath = resolve(projectRoot, "workbuddy/render_workbuddy_template.py");

function manifestFor(count, template) {
  const databaseBindings = Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const position = index + 1;
      const alias = `table${position}`;
      return [
        alias,
        {
          placeholder: `__PING_CLASS_DB_TABLE_${position}__`,
          schemaVersion: 1,
          title: `测试资料表 ${position}`,
          createSchema: {
            title: `测试资料表 ${position}`,
            properties: [{ name: `字段 ${position}`, config: { text: "" } }],
          },
          requiredFields: [{ name: `字段 ${position}`, type: "text" }],
          seedPolicy: "never",
          seedRecords: [],
        },
      ];
    }),
  );
  return {
    protocolVersion: 1,
    appId: "io.github.yihuier.workbuddy-ping-class",
    name: "Ping Class cardinality test",
    version: "9.9.9",
    repository: "https://github.com/yihuier/workbuddy-ping-class",
    testedWorkBuddySkillLibraryVersions: [],
    page: {
      fileName: "test.html",
      appVersionPlaceholder: "__PING_CLASS_APP_VERSION__",
    },
    installationState: {
      format: "ping-class-installation-state/v1",
      title: "test",
      marker: "test",
    },
    databaseBindings,
    migrations: [],
    assets: {
      template: {
        file: "template.html",
        sha256: sha256(Buffer.from(template, "utf8")),
        size: Buffer.byteLength(template, "utf8"),
      },
    },
  };
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "ping-class-cardinality-"));
try {
  for (const count of [1, 4, 6]) {
    const placeholders = Array.from(
      { length: count },
      (_, index) => `__PING_CLASS_DB_TABLE_${index + 1}__`,
    );
    const databaseCalls = placeholders
      .map(
        (placeholder) =>
          `window.__SMART_PAGE__.database.query({databaseId:"${placeholder}"});`,
      )
      .join("\n");
    const template = [
      "<!doctype html>",
      '<html><head><meta name="ping-class-version" content="__PING_CLASS_APP_VERSION__"></head>',
      `<body><script>${databaseCalls}</script></body></html>`,
    ].join("\n");
    const manifest = validateManifest(manifestFor(count, template));
    const mapping = Object.fromEntries(
      bindingEntries(manifest).map(([alias], index) => [alias, `CARDINALITY_TEST_${count}_${index + 1}`]),
    );
    const normalized = normalizeMapping(mapping, manifest);
    if (Object.keys(normalized).length !== count) throw new Error(`${count} 表映射数量错误`);
    if (createMergedSchema(manifest).properties.length !== count) {
      throw new Error(`${count} 表合并 schema 数量错误`);
    }

    const caseDirectory = resolve(temporaryDirectory, String(count));
    mkdirSync(caseDirectory, { recursive: true });
    const templatePath = resolve(caseDirectory, "template.html");
    const manifestPath = resolve(caseDirectory, "manifest.json");
    const mappingPath = resolve(caseDirectory, "mapping.json");
    const outputPath = resolve(caseDirectory, "output.html");
    writeFileSync(templatePath, template, "utf8");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");
    run(
      "python3",
      [
        rendererPath,
        "--manifest",
        manifestPath,
        "--template",
        templatePath,
        "--mapping",
        mappingPath,
        "--output",
        outputPath,
      ],
      { cwd: projectRoot },
    );
    const output = readFileSync(outputPath, "utf8");
    if (/__PING_CLASS_[A-Z0-9_]+__/.test(output)) throw new Error(`${count} 表渲染仍含 placeholder`);
    for (const databaseId of Object.values(mapping)) {
      if (!output.includes(databaseId)) throw new Error(`${count} 表渲染缺少 ${databaseId}`);
    }
  }
  process.stdout.write("数据库绑定数量矩阵验证通过（1 / 4 / 6）\n");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

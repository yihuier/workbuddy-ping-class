import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bindingEntries, readJson, validateManifest } from "./lib/workbuddy-release.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const config = readJson(resolve(projectRoot, "workbuddy.config.json"), "workbuddy.config.json");
const manifest = validateManifest(readJson(resolve(projectRoot, config.manifest), config.manifest));
const outputPath = resolve(projectRoot, config.localMapping);

if (existsSync(outputPath)) {
  process.stderr.write(`${config.localMapping} 已存在，未覆盖。\n`);
  process.exit(1);
}

const mapping = Object.fromEntries(
  bindingEntries(manifest).map(([alias]) => [
    alias,
    `REPLACE_WITH_${alias.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_DATABASE_ID`,
  ]),
);
writeFileSync(outputPath, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");
process.stdout.write(
  `已生成 ${config.localMapping}（${Object.keys(mapping).length} 个当前数据库绑定）；请填写自己的 databaseId。\n`,
);

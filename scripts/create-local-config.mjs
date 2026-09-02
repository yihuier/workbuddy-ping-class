import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  bindingEntries,
  isObject,
  readJson,
  validateManifest,
} from "./lib/workbuddy-release.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const config = readJson(resolve(projectRoot, "workbuddy.config.json"), "workbuddy.config.json");
const manifest = validateManifest(readJson(resolve(projectRoot, config.manifest), config.manifest));
const outputPath = resolve(projectRoot, config.localMapping);

const outputExists = existsSync(outputPath);
const existingDocument = outputExists
  ? readJson(outputPath, config.localMapping)
  : {};
if (!isObject(existingDocument)) {
  throw new Error(`${config.localMapping} 必须是 JSON 对象`);
}
if ("databaseBindings" in existingDocument && !isObject(existingDocument.databaseBindings)) {
  throw new Error(`${config.localMapping}.databaseBindings 必须是 JSON 对象`);
}
const nestedMapping = isObject(existingDocument.databaseBindings);
const existingMapping = nestedMapping ? existingDocument.databaseBindings : existingDocument;
const missingEntries = bindingEntries(manifest)
  .filter(([alias]) => !(alias in existingMapping))
  .map(([alias]) => [
    alias,
    `REPLACE_WITH_${alias.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_DATABASE_ID`,
  ]);

if (!missingEntries.length) {
  process.stdout.write(`${config.localMapping} 已包含 manifest 当前全部数据库绑定，未修改。\n`);
  process.exit(0);
}

const mapping = { ...existingMapping, ...Object.fromEntries(missingEntries) };
const outputDocument = nestedMapping
  ? { ...existingDocument, databaseBindings: mapping }
  : mapping;
writeFileSync(outputPath, `${JSON.stringify(outputDocument, null, 2)}\n`, "utf8");
process.stdout.write(
  `${outputExists ? "已更新" : "已生成"} ${config.localMapping}，新增 ${missingEntries.length} 个数据库绑定；请填写对应 databaseId。\n`,
);

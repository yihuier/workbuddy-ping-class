import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const MAX_HTML_BYTES = 50 * 1024 * 1024;
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const DATABASE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readJson(path, label = path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 ${label}：${error instanceof Error ? error.message : "未知错误"}`);
  }
  if (!isObject(value)) throw new Error(`${label} 顶层必须是对象`);
  return value;
}

export function assertProjectPath(projectRoot, path, label) {
  const resolvedPath = resolve(projectRoot, path);
  const relativePath = relative(projectRoot, resolvedPath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} 必须位于项目目录内`);
  }
  return resolvedPath;
}

function hasOnlyKeys(value, keys) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function validateBinding(alias, binding, placeholders) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(alias) || !isObject(binding)) {
    throw new Error(`databaseBindings alias 非法：${alias}`);
  }
  if (
    typeof binding.placeholder !== "string" ||
    !/^__PING_CLASS_DB_[A-Z0-9_]+__$/.test(binding.placeholder) ||
    placeholders.has(binding.placeholder)
  ) {
    throw new Error(`${alias} 的 placeholder 缺失、格式非法或重复`);
  }
  placeholders.add(binding.placeholder);
  if (!Number.isInteger(binding.schemaVersion) || binding.schemaVersion < 1) {
    throw new Error(`${alias} 的 schemaVersion 必须是正整数`);
  }
  if (typeof binding.title !== "string" || !binding.title.trim()) {
    throw new Error(`${alias} 缺少资料表标题`);
  }
  if (
    !isObject(binding.createSchema) ||
    binding.createSchema.title !== binding.title ||
    !Array.isArray(binding.createSchema.properties) ||
    !binding.createSchema.properties.length
  ) {
    throw new Error(`${alias} 的 createSchema 缺失或与标题不一致`);
  }

  const fieldTypes = new Map();
  for (const property of binding.createSchema.properties) {
    if (
      !isObject(property) ||
      typeof property.name !== "string" ||
      !property.name.trim() ||
      !isObject(property.config) ||
      Object.keys(property.config).length !== 1 ||
      fieldTypes.has(property.name)
    ) {
      throw new Error(`${alias} 的 createSchema 含非法或重复字段`);
    }
    fieldTypes.set(property.name, Object.keys(property.config)[0]);
  }
  if (!Array.isArray(binding.requiredFields) || !binding.requiredFields.length) {
    throw new Error(`${alias} 缺少 requiredFields`);
  }
  const requiredNames = new Set();
  for (const field of binding.requiredFields) {
    if (
      !isObject(field) ||
      typeof field.name !== "string" ||
      typeof field.type !== "string" ||
      fieldTypes.get(field.name) !== field.type ||
      requiredNames.has(field.name)
    ) {
      throw new Error(`${alias} 的 requiredFields 与 createSchema 不一致`);
    }
    requiredNames.add(field.name);
  }
  if (binding.seedPolicy !== "never" && binding.seedPolicy !== "install-if-empty") {
    throw new Error(`${alias} 的 seedPolicy 非法`);
  }
  if (!Array.isArray(binding.seedRecords) || binding.seedRecords.some((record) => !isObject(record))) {
    throw new Error(`${alias} 的 seedRecords 必须是对象数组`);
  }
  if (binding.seedPolicy === "never" && binding.seedRecords.length) {
    throw new Error(`${alias} 使用 seedPolicy=never 时不得包含 seedRecords`);
  }
}

function validateOperation(operation, migration) {
  const edge = `${migration.database}:${migration.fromSchemaVersion}->${migration.toSchemaVersion}`;
  if (!isObject(operation) || typeof operation.type !== "string") {
    throw new Error(`${edge} 含非法 operation`);
  }
  switch (operation.type) {
    case "addField":
      if (
        !hasOnlyKeys(operation, ["type", "property"]) ||
        !isObject(operation.property) ||
        typeof operation.property.name !== "string" ||
        !operation.property.name.trim() ||
        !isObject(operation.property.config) ||
        Object.keys(operation.property.config).length !== 1
      ) {
        throw new Error(`${edge} 的 addField 格式非法`);
      }
      return;
    case "renameField":
      if (
        !hasOnlyKeys(operation, ["type", "fieldName", "newName"]) ||
        typeof operation.fieldName !== "string" ||
        !operation.fieldName.trim() ||
        typeof operation.newName !== "string" ||
        !operation.newName.trim()
      ) {
        throw new Error(`${edge} 的 renameField 格式非法`);
      }
      return;
    case "addSelectOptions":
      if (
        !hasOnlyKeys(operation, ["type", "fieldName", "options"]) ||
        typeof operation.fieldName !== "string" ||
        !operation.fieldName.trim() ||
        !Array.isArray(operation.options) ||
        !operation.options.length ||
        operation.options.some(
          (option) =>
            !isObject(option) ||
            !hasOnlyKeys(option, ["text"]) ||
            typeof option.text !== "string" ||
            !option.text.trim(),
        )
      ) {
        throw new Error(`${edge} 的 addSelectOptions 格式非法`);
      }
      return;
    case "seedIfEmpty":
      if (
        !hasOnlyKeys(operation, ["type", "records"]) ||
        !Array.isArray(operation.records) ||
        !operation.records.length ||
        operation.records.some((record) => !isObject(record))
      ) {
        throw new Error(`${edge} 的 seedIfEmpty 格式非法`);
      }
      return;
    case "createDatabase":
      if (
        !hasOnlyKeys(operation, ["type"]) ||
        migration.fromSchemaVersion !== 0 ||
        migration.toSchemaVersion !== 1 ||
        migration.operations.length !== 1
      ) {
        throw new Error(`${edge} 的 createDatabase 只能独占 0 -> 1 版本边`);
      }
      return;
    default:
      throw new Error(`${edge} 含未知 operation：${operation.type}`);
  }
}

function validateMigrations(manifest) {
  if (!Array.isArray(manifest.migrations)) throw new Error("app manifest migrations 必须是数组");
  const edges = new Set();
  for (const migration of manifest.migrations) {
    if (
      !isObject(migration) ||
      !hasOnlyKeys(migration, ["database", "fromSchemaVersion", "toSchemaVersion", "operations"])
    ) {
      throw new Error("migration 只能包含 database、schema 版本和 operations");
    }
    const binding = manifest.databaseBindings[migration.database];
    if (typeof migration.database !== "string" || !isObject(binding)) {
      throw new Error(`migration 引用了未知 database alias：${String(migration.database)}`);
    }
    if (
      !Number.isInteger(migration.fromSchemaVersion) ||
      migration.fromSchemaVersion < 0 ||
      !Number.isInteger(migration.toSchemaVersion) ||
      migration.toSchemaVersion !== migration.fromSchemaVersion + 1 ||
      migration.toSchemaVersion > binding.schemaVersion
    ) {
      throw new Error(`${migration.database} migration 的 schema 版本边非法`);
    }
    const edge = `${migration.database}:${migration.fromSchemaVersion}->${migration.toSchemaVersion}`;
    if (edges.has(edge)) throw new Error(`migration 版本边重复：${edge}`);
    edges.add(edge);
    if (!Array.isArray(migration.operations) || !migration.operations.length) {
      throw new Error(`${edge} 缺少 operations`);
    }
    migration.operations.forEach((operation) => validateOperation(operation, migration));
    if (migration.fromSchemaVersion === 0 && migration.operations[0].type !== "createDatabase") {
      throw new Error(`${edge} 的 0 -> 1 版本边必须使用 createDatabase`);
    }
    if (
      migration.fromSchemaVersion > 0 &&
      migration.operations.some((operation) => operation.type === "createDatabase")
    ) {
      throw new Error(`${edge} 不得在已有资料表上执行 createDatabase`);
    }
  }
  for (const [alias, binding] of bindingEntries(manifest)) {
    for (let version = 1; version < binding.schemaVersion; version += 1) {
      const edge = `${alias}:${version}->${version + 1}`;
      if (!edges.has(edge)) throw new Error(`${alias} 缺少连续 migration：${version} -> ${version + 1}`);
    }
  }
}

export function validateManifest(manifest) {
  if (manifest.protocolVersion !== 1) throw new Error("app manifest protocolVersion 必须为 1");
  if (typeof manifest.appId !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i.test(manifest.appId)) {
    throw new Error("app manifest appId 非法");
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) throw new Error("app manifest 缺少名称");
  if (typeof manifest.version !== "string" || !SEMVER_RE.test(manifest.version)) {
    throw new Error("app manifest version 不是有效 SemVer");
  }
  if (typeof manifest.repository !== "string" || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(manifest.repository)) {
    throw new Error("app manifest repository 必须是 GitHub HTTPS 仓库地址");
  }
  if (
    !isObject(manifest.page) ||
    typeof manifest.page.fileName !== "string" ||
    !/\.html?$/i.test(manifest.page.fileName) ||
    typeof manifest.page.appVersionPlaceholder !== "string"
  ) {
    throw new Error("app manifest page 配置非法");
  }
  if (!isObject(manifest.databaseBindings) || !Object.keys(manifest.databaseBindings).length) {
    throw new Error("app manifest 缺少 databaseBindings");
  }
  const placeholders = new Set();
  for (const [alias, binding] of bindingEntries(manifest)) validateBinding(alias, binding, placeholders);
  validateMigrations(manifest);
  return manifest;
}

export function bindingEntries(manifest) {
  return Object.entries(manifest.databaseBindings ?? {});
}

export function createMergedSchema(manifest) {
  const properties = [];
  const knownTypes = new Map();
  for (const [alias, binding] of bindingEntries(manifest)) {
    for (const [index, property] of binding.createSchema.properties.entries()) {
      const [type, rawConfig] = Object.entries(property.config)[0];
      const existingType = knownTypes.get(property.name);
      if (existingType && existingType !== type) {
        throw new Error(`字段「${property.name}」在 ${alias} 中与其它资料表类型冲突`);
      }
      if (existingType) continue;
      knownTypes.set(property.name, type);
      const schemaProperty = {
        id: `manifest_${alias}_${index + 1}`,
        name: property.name,
        type,
      };
      if ((type === "select" || type === "multi_select") && isObject(rawConfig)) {
        schemaProperty.config = {
          options: Array.isArray(rawConfig.options)
            ? rawConfig.options.map((option, optionIndex) => ({
                id: option.id ?? `manifest_${alias}_${index + 1}_${optionIndex + 1}`,
                text: option.text,
              }))
            : [],
        };
      }
      properties.push(schemaProperty);
    }
  }
  return {
    id: `${manifest.appId}:merged-schema`,
    title: `${manifest.name} 全部资料库字段`,
    properties,
  };
}

export function createTestMapping(manifest, prefix = "PINGCLASS_TEST_DB") {
  return Object.fromEntries(
    bindingEntries(manifest).map(([alias], index) => [
      alias,
      `${prefix}_${String(index + 1).padStart(2, "0")}_${alias}`,
    ]),
  );
}

function mappingId(rawValue, alias) {
  const value = isObject(rawValue) ? rawValue.id : rawValue;
  if (typeof value !== "string" || !DATABASE_ID_RE.test(value)) {
    throw new Error(`${alias} 的 databaseId 缺失或格式非法`);
  }
  return value;
}

export function normalizeMapping(rawMapping, manifest) {
  const mapping = isObject(rawMapping.databaseBindings) ? rawMapping.databaseBindings : rawMapping;
  const aliases = bindingEntries(manifest).map(([alias]) => alias);
  const aliasSet = new Set(aliases);
  const extraAliases = Object.keys(mapping).filter((alias) => !aliasSet.has(alias));
  if (extraAliases.length) throw new Error(`映射包含 manifest 未声明的 alias：${extraAliases.join(", ")}`);
  const normalized = Object.fromEntries(
    aliases.map((alias) => {
      if (!(alias in mapping)) throw new Error(`映射缺少 manifest alias：${alias}`);
      return [alias, mappingId(mapping[alias], alias)];
    }),
  );
  if (new Set(Object.values(normalized)).size !== aliases.length) {
    throw new Error("不同逻辑表不能绑定到同一个 databaseId");
  }
  return normalized;
}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw new Error(`${command} 无法执行：${result.error.message}`);
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} 退出码为 ${result.status ?? "未知"}${output ? `\n${output}` : ""}`);
  }
  return result;
}

export function findWorkBuddySkillRoot(manifest) {
  const explicitRoot = process.env.WORKBUDDY_SKILL_LIBRARY;
  if (explicitRoot) return existsSync(explicitRoot) ? resolve(explicitRoot) : null;
  const versions = Array.isArray(manifest.testedWorkBuddySkillLibraryVersions)
    ? manifest.testedWorkBuddySkillLibraryVersions
    : [];
  for (const version of versions) {
    const candidate = resolve(
      homedir(),
      ".workbuddy/plugins/cache/workbuddy-builtin/skill-library",
      String(version),
    );
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

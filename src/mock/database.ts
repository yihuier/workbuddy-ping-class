import type {
  DatabaseFieldValue,
  DatabaseFilter,
  DatabaseProperty,
  DatabaseRecord,
  DatabaseSchema,
  DatabaseSdk,
  FieldType,
  PropertyValue,
  QueryParams,
  QueryResult,
} from "../workbuddy";
import appManifest from "../../workbuddy/app-manifest.json";

const STORAGE_PREFIX = "ping-class:mockdb:v2:";

interface ManifestProperty {
  name: string;
  config: Record<string, unknown>;
}

interface ManifestBinding {
  placeholder: string;
  title: string;
  createSchema: {
    properties: ManifestProperty[];
  };
}

const manifestBindings = appManifest.databaseBindings as Record<string, ManifestBinding>;

const schemas = new Map<string, DatabaseSchema>();
const seedFiles = new Map<string, string>();
let initialization: Promise<void> | null = null;

function delay(): Promise<void> {
  const duration = 70 + Math.floor(Math.random() * 90);
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return (await response.json()) as T;
}

function storageKey(databaseId: string): string {
  return `${STORAGE_PREFIX}${databaseId}`;
}

function loadRecords(databaseId: string): DatabaseRecord[] | null {
  const raw = window.localStorage.getItem(storageKey(databaseId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DatabaseRecord[];
  } catch {
    window.localStorage.removeItem(storageKey(databaseId));
    return null;
  }
}

function saveRecords(databaseId: string, records: DatabaseRecord[]): void {
  window.localStorage.setItem(storageKey(databaseId), JSON.stringify(records));
}

function requireSchema(databaseId: string): DatabaseSchema {
  const schema = schemas.get(databaseId);
  if (!schema) {
    throw new Error(`[MockDB] 未注册的 databaseId: ${databaseId}`);
  }
  return schema;
}

function requireRecords(databaseId: string): DatabaseRecord[] {
  const records = loadRecords(databaseId);
  if (!records) {
    throw new Error(`[MockDB] 数据尚未完成播种: ${databaseId}`);
  }
  return records;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getFieldType(schema: DatabaseSchema, fieldName: string): FieldType | undefined {
  return schema.properties.find((property) => property.name === fieldName)?.type;
}

function optionText(schema: DatabaseSchema, fieldName: string, value: string): string {
  const property = schema.properties.find((item) => item.name === fieldName);
  return property?.config?.options?.find((option) => option.id === value)?.text ?? value;
}

function flattenProperty(
  schema: DatabaseSchema,
  fieldName: string,
  property: PropertyValue,
): DatabaseFieldValue {
  if ("text" in property) return property.text;
  if ("number" in property) return Number(property.number);
  if ("select" in property) return optionText(schema, fieldName, property.select);
  if ("multi_select" in property) {
    return property.multi_select.map((value) => optionText(schema, fieldName, value));
  }
  if ("date" in property) return property.date;
  if ("checkbox" in property) return Boolean(property.checkbox);
  if ("url" in property) return property.url;
  if ("email" in property) return property.email;
  if ("phone_number" in property) return property.phone_number;
  if ("image" in property) return property.image.images;
  return null;
}

function asText(value: DatabaseFieldValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(",");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function evaluateCondition(record: DatabaseRecord, filter: DatabaseFilter): boolean {
  if ("and" in filter) return filter.and.every((item) => evaluateCondition(record, item));
  if ("or" in filter) return filter.or.some((item) => evaluateCondition(record, item));

  const condition = filter.property;
  const value = record[condition.property];
  const typeKey = (["text", "number", "select", "date", "checkbox"] as const).find(
    (key) => condition[key] !== undefined,
  );
  if (!typeKey) return true;

  const operators = condition[typeKey] ?? {};
  const [operator] = Object.keys(operators);
  const target = operator ? operators[operator] : undefined;

  switch (operator) {
    case "equals":
      if (Array.isArray(value)) {
        return value.some((item) => typeof item === "string" && item === String(target));
      }
      if (typeKey === "checkbox") return Boolean(value) === Boolean(target);
      if (typeKey === "number") return Number(value) === Number(target);
      return asText(value) === String(target ?? "");
    case "does_not_equal":
      if (Array.isArray(value)) {
        return !value.some((item) => typeof item === "string" && item === String(target));
      }
      return asText(value) !== String(target ?? "");
    case "contains":
      return asText(value).includes(String(target ?? ""));
    case "greater_than":
      return Number(value) > Number(target);
    case "less_than":
      return Number(value) < Number(target);
    case "before":
      return Boolean(value) && asText(value) < String(target ?? "");
    case "after":
      return Boolean(value) && asText(value) > String(target ?? "");
    default:
      return true;
  }
}

function compareValues(
  left: DatabaseFieldValue | undefined,
  right: DatabaseFieldValue | undefined,
  fieldType: FieldType | undefined,
): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  if (fieldType === "number") return Number(left) - Number(right);
  return asText(left).localeCompare(asText(right), "zh-CN", { numeric: true });
}

function projectRecord(record: DatabaseRecord, fields?: string[]): DatabaseRecord {
  if (!fields?.length) return clone(record);
  const projected: DatabaseRecord = { _id: record._id };
  fields.forEach((field) => {
    projected[field] = record[field] ?? null;
  });
  return projected;
}

function validateProperties(schema: DatabaseSchema, properties: Record<string, PropertyValue>): void {
  const validFields = new Set(schema.properties.map((property) => property.name));
  Object.keys(properties).forEach((fieldName) => {
    if (!validFields.has(fieldName)) {
      throw new Error(`[MockDB] 字段不存在: ${fieldName}`);
    }
  });
}

function mockProperty(alias: string, property: ManifestProperty, propertyIndex: number): DatabaseProperty {
  const configEntries = Object.entries(property.config);
  if (configEntries.length !== 1) {
    throw new Error(`[MockDB] ${alias}.${property.name} 的字段配置必须只声明一种类型`);
  }

  const [type, rawConfig] = configEntries[0] as [FieldType, unknown];
  const supportedTypes: FieldType[] = [
    "text",
    "number",
    "select",
    "multi_select",
    "date",
    "checkbox",
    "url",
    "email",
    "phone_number",
    "image",
  ];
  if (!supportedTypes.includes(type)) {
    throw new Error(`[MockDB] ${alias}.${property.name} 使用了暂不支持的字段类型: ${type}`);
  }

  const result: DatabaseProperty = {
    id: `mock_${alias}_field_${propertyIndex + 1}`,
    name: property.name,
    type,
  };
  if (type === "select" || type === "multi_select") {
    const options =
      rawConfig && typeof rawConfig === "object" && "options" in rawConfig
        ? (rawConfig.options as Array<{ id?: string; text?: string }>)
        : [];
    result.config = {
      options: options.map((option, optionIndex) => ({
        id: option.id ?? `mock_${alias}_${propertyIndex + 1}_option_${optionIndex + 1}`,
        text: option.text ?? `选项 ${optionIndex + 1}`,
      })),
    };
  }
  return result;
}

async function initialize(): Promise<void> {
  Object.entries(manifestBindings).forEach(([alias, binding]) => {
    schemas.set(binding.placeholder, {
      id: binding.placeholder,
      title: binding.title,
      properties: binding.createSchema.properties.map((property, index) =>
        mockProperty(alias, property, index),
      ),
    });
    seedFiles.set(binding.placeholder, `/mock/data/${alias}.json`);
  });

  await Promise.all(
    [...schemas.keys()].map(async (databaseId) => {
      if (loadRecords(databaseId)) return;
      const seedPath = seedFiles.get(databaseId);
      try {
        const records = seedPath ? await fetchJson<DatabaseRecord[]>(seedPath) : [];
        saveRecords(databaseId, records);
      } catch {
        saveRecords(databaseId, []);
      }
    }),
  );
}

function ready(): Promise<void> {
  if (!initialization) initialization = initialize();
  return initialization;
}

const mockDatabase: DatabaseSdk = {
  async query(params: QueryParams): Promise<QueryResult> {
    await ready();
    await delay();
    const schema = requireSchema(params.databaseId);
    let records = [...requireRecords(params.databaseId)];
    if (params.filter) {
      records = records.filter((record) => evaluateCondition(record, params.filter as DatabaseFilter));
    }
    if (params.sorts?.length) {
      records.sort((left, right) => {
        for (const sort of params.sorts ?? []) {
          const comparison = compareValues(
            left[sort.property],
            right[sort.property],
            getFieldType(schema, sort.property),
          );
          if (comparison !== 0) return sort.direction === "descending" ? -comparison : comparison;
        }
        return 0;
      });
    }

    const pageSize = Math.max(1, Math.min(params.pageSize ?? 100, 200));
    const cursorIndex = params.startCursor
      ? records.findIndex((record) => record._id === params.startCursor)
      : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const page = records.slice(start, start + pageSize).map((record) => projectRecord(record, params.fields));
    const hasMore = start + pageSize < records.length;
    return {
      results: page,
      nextCursor: hasMore && page.length ? page[page.length - 1]?._id ?? null : null,
      hasMore,
    };
  },

  async getRecord(params) {
    await ready();
    await delay();
    requireSchema(params.databaseId);
    const record = requireRecords(params.databaseId).find((item) => item._id === params.recordId);
    if (!record) throw new Error(`[MockDB] 记录不存在: ${params.recordId}`);
    return { result: projectRecord(record, params.fields) };
  },

  async addRecord(params) {
    await ready();
    await delay();
    const schema = requireSchema(params.databaseId);
    validateProperties(schema, params.properties);
    const record: DatabaseRecord = {
      _id: `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    };
    Object.entries(params.properties).forEach(([fieldName, property]) => {
      record[fieldName] = flattenProperty(schema, fieldName, property);
    });
    const records = requireRecords(params.databaseId);
    records.push(record);
    saveRecords(params.databaseId, records);
    return { id: record._id };
  },

  async updateRecord(params) {
    await ready();
    await delay();
    const schema = requireSchema(params.databaseId);
    const properties = params.properties ?? {};
    validateProperties(schema, properties);
    const records = requireRecords(params.databaseId);
    const record = records.find((item) => item._id === params.recordId);
    if (!record) throw new Error(`[MockDB] 记录不存在: ${params.recordId}`);
    Object.entries(properties).forEach(([fieldName, property]) => {
      record[fieldName] = flattenProperty(schema, fieldName, property);
    });
    saveRecords(params.databaseId, records);
    return { id: record._id };
  },

  async deleteRecord(params) {
    await ready();
    await delay();
    requireSchema(params.databaseId);
    const records = requireRecords(params.databaseId);
    const nextRecords = records.filter((item) => item._id !== params.recordId);
    if (nextRecords.length === records.length) {
      throw new Error(`[MockDB] 记录不存在: ${params.recordId}`);
    }
    saveRecords(params.databaseId, nextRecords);
    return {};
  },

  async getSchema(params) {
    await ready();
    await delay();
    return clone(requireSchema(params.databaseId));
  },
};

export function installMockDatabase(): void {
  if (window.__SMART_PAGE__?.database) return;
  window.__SMART_PAGE__ = { database: mockDatabase };
  window.__PING_CLASS_MOCK_DATABASE__ = true;
}

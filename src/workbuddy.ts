export type FieldType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone_number"
  | "image";

export interface SelectOption {
  id: string;
  text: string;
}

export interface DatabaseProperty {
  id: string;
  name: string;
  type: FieldType;
  config?: {
    options?: SelectOption[];
  };
}

export interface DatabaseSchema {
  id: string;
  title: string;
  properties: DatabaseProperty[];
}

export interface UrlValue {
  text: string;
  link: string;
}

export interface ImageValue {
  imageUrl: string;
  title?: string;
  width?: number;
  height?: number;
}

export type DatabaseFieldValue =
  | string
  | number
  | boolean
  | string[]
  | UrlValue
  | ImageValue[]
  | null;

export interface DatabaseRecord {
  _id: string;
  [field: string]: DatabaseFieldValue;
}

export type PropertyValue =
  | { text: string }
  | { number: number }
  | { select: string }
  | { multi_select: string[] }
  | { date: string }
  | { checkbox: boolean }
  | { url: UrlValue }
  | { email: string }
  | { phone_number: string }
  | { image: { images: ImageValue[] } };

export interface FilterCondition {
  property: {
    property: string;
    text?: Record<string, unknown>;
    number?: Record<string, unknown>;
    select?: Record<string, unknown>;
    date?: Record<string, unknown>;
    checkbox?: Record<string, unknown>;
  };
}

export type DatabaseFilter =
  | FilterCondition
  | { and: DatabaseFilter[] }
  | { or: DatabaseFilter[] };

export interface QueryParams {
  databaseId: string;
  filter?: DatabaseFilter;
  sorts?: Array<{ property: string; direction: "ascending" | "descending" }>;
  fields?: string[];
  startCursor?: string;
  pageSize?: number;
}

export interface QueryResult {
  results: DatabaseRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface DatabaseSdk {
  query(params: QueryParams): Promise<QueryResult>;
  addRecord(params: {
    databaseId: string;
    properties: Record<string, PropertyValue>;
  }): Promise<{ id: string }>;
  getRecord(params: {
    databaseId: string;
    recordId: string;
    fields?: string[];
  }): Promise<{ result: DatabaseRecord }>;
  updateRecord(params: {
    databaseId: string;
    recordId: string;
    properties?: Record<string, PropertyValue>;
  }): Promise<{ id: string }>;
  deleteRecord(params: { databaseId: string; recordId: string }): Promise<Record<string, never>>;
  getSchema(params: { databaseId: string }): Promise<DatabaseSchema>;
}

declare global {
  interface Window {
    __SMART_PAGE__: {
      database: DatabaseSdk;
    };
    __PING_CLASS_MOCK_DATABASE__?: boolean;
  }
}

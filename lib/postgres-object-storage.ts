import { getD1 } from "../db";

export type StoredObject = {
  body: ArrayBuffer;
  size: number;
  httpMetadata?: {
    contentType?: string;
    contentDisposition?: string;
  };
  customMetadata?: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type PutOptions = {
  httpMetadata?: {
    contentType?: string;
    contentDisposition?: string;
  };
  customMetadata?: Record<string, string>;
};

const createTableSql = `
  CREATE TABLE IF NOT EXISTS object_storage_files (
    object_key TEXT PRIMARY KEY,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    content_disposition TEXT NOT NULL DEFAULT '',
    custom_metadata TEXT NOT NULL DEFAULT '{}',
    body BYTEA NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

let readyPromise: Promise<void> | null = null;

async function ensureReady() {
  if (!readyPromise) {
    readyPromise = getD1()
      .prepare(createTableSql)
      .run()
      .then(() => undefined)
      .catch((error) => {
        readyPromise = null;
        throw error;
      });
  }
  return readyPromise;
}

async function inputBytes(
  value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream,
) {
  if (value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  }
  return new Uint8Array(await new Response(value).arrayBuffer());
}

function storedBytes(value: unknown) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string" && value.startsWith("\\x")) {
    const hex = value.slice(2);
    const bytes = new Uint8Array(Math.floor(hex.length / 2));
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }
  return new Uint8Array();
}

function metadata(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, item]) => [
        key,
        String(item ?? ""),
      ]),
    );
  } catch {
    return {};
  }
}

export function getPostgresObjectStorage() {
  return {
    async put(
      key: string,
      value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream,
      options: PutOptions = {},
    ) {
      await ensureReady();
      const bytes = await inputBytes(value);
      await getD1()
        .prepare(
          `INSERT INTO object_storage_files (
             object_key, content_type, content_disposition, custom_metadata,
             body, size_bytes, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(object_key) DO UPDATE SET
             content_type = excluded.content_type,
             content_disposition = excluded.content_disposition,
             custom_metadata = excluded.custom_metadata,
             body = excluded.body,
             size_bytes = excluded.size_bytes,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          key,
          options.httpMetadata?.contentType || "application/octet-stream",
          options.httpMetadata?.contentDisposition || "",
          JSON.stringify(options.customMetadata ?? {}),
          bytes,
          bytes.byteLength,
        )
        .run();
      return { key, size: bytes.byteLength };
    },

    async get(key: string): Promise<StoredObject | null> {
      await ensureReady();
      const row = await getD1()
        .prepare(
          `SELECT body, size_bytes, content_type, content_disposition,
                  custom_metadata
           FROM object_storage_files
           WHERE object_key = ?
           LIMIT 1`,
        )
        .bind(key)
        .first<{
          body: unknown;
          size_bytes: number;
          content_type: string;
          content_disposition: string;
          custom_metadata: string;
        }>();
      if (!row) return null;
      const bytes = storedBytes(row.body);
      const body = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      return {
        body,
        size: Number(row.size_bytes) || bytes.byteLength,
        httpMetadata: {
          contentType: row.content_type,
          contentDisposition: row.content_disposition,
        },
        customMetadata: metadata(row.custom_metadata),
        async arrayBuffer() {
          return body.slice(0);
        },
      };
    },

    async delete(keys: string | string[]) {
      await ensureReady();
      const values = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
      if (!values.length) return;
      const placeholders = values.map(() => "?").join(", ");
      await getD1()
        .prepare(
          `DELETE FROM object_storage_files
           WHERE object_key IN (${placeholders})`,
        )
        .bind(...values)
        .run();
    },
  };
}

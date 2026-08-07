import postgres from "postgres";
import {
  VERCEL_BASE_SCHEMA_VERSION,
  VERCEL_INCREMENTAL_SCHEMA_SQL,
  VERCEL_LOCAL_AUTH_SCHEMA_SQL,
  VERCEL_PREVIOUS_SCHEMA_VERSION,
  VERCEL_SCHEMA_SQL,
  VERCEL_SCHEMA_VERSION,
} from "./vercel-schema";

type QueryRow = Record<string, any>;

export type D1Result<T extends QueryRow = QueryRow> = {
  results: T[];
  success: true;
  meta: {
    changes: number;
    last_row_id?: number;
  };
};

type QueryExecutor = {
  unsafe: (query: string, parameters?: unknown[]) => Promise<unknown>;
};

type PostgresResult<T extends QueryRow = QueryRow> = T[] & {
  count?: number;
};

export function isPostgresDatabase() {
  return true;
}

function normalizeD1Row<T extends QueryRow>(row: T): T {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date
        ? value.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")
        : value,
    ]),
  ) as T;
}

const globalDatabase = globalThis as typeof globalThis & {
  whizzupPostgres?: ReturnType<typeof postgres>;
  whizzupSchemaReady?: Promise<void>;
};

const DATABASE_QUERY_TIMEOUT_MS = 15_000;
const DATABASE_SCHEMA_TIMEOUT_MS = 25_000;

export class DatabaseConnectionTimeoutError extends Error {
  constructor(message = "데이터베이스 응답 시간이 초과되었습니다.") {
    super(message);
    this.name = "DatabaseConnectionTimeoutError";
  }
}

async function withDatabaseTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new DatabaseConnectionTimeoutError()),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function isDatabaseUnavailableError(error: unknown) {
  if (error instanceof DatabaseConnectionTimeoutError) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /ECHECKOUTTIMEOUT|unable to check out connection|connection.*(?:timeout|timed out)|database.*(?:timeout|timed out)/i.test(message);
}

function isRetryableConnectionReset(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /socket|terminated|closed|reset|econn/i.test(message);
}

async function recycleSqlClient(
  expectedClient: ReturnType<typeof postgres>,
) {
  if (globalDatabase.whizzupPostgres !== expectedClient) return;
  globalDatabase.whizzupPostgres = undefined;
  await expectedClient.end({ timeout: 1 }).catch(() => undefined);
}

function databaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "DATABASE_URL이 설정되지 않았습니다. Vercel 환경변수에 Supabase 연결 문자열을 등록해 주세요.",
    );
  }
  return value;
}

function getSqlClient() {
  if (!globalDatabase.whizzupPostgres) {
    globalDatabase.whizzupPostgres = postgres(databaseUrl(), {
      prepare: false,
      ssl: "require",
      // Vercel can keep a separate warm instance for every API route. Holding
      // three database connections per instance quickly exhausts Supabase's
      // transaction pool, so each instance must share one short-lived client.
      max: 1,
      idle_timeout: 2,
      connect_timeout: 8,
      max_lifetime: 30,
      connection: {
        statement_timeout: 12000,
        lock_timeout: 5000,
        idle_in_transaction_session_timeout: 15000,
      },
    });
  }
  return globalDatabase.whizzupPostgres;
}

async function schemaVersionExists(executor: QueryExecutor, version: string) {
  const migrationTable = (await executor.unsafe(
    "SELECT to_regclass('public.vercel_schema_migrations')::text AS relation_name",
  )) as QueryRow[];
  if (!migrationTable[0]?.relation_name) return false;
  const current = (await executor.unsafe(
    `SELECT 1 AS current
     FROM public.vercel_schema_migrations
     WHERE version = $1
     LIMIT 1`,
    [version],
  )) as QueryRow[];
  return current.length > 0;
}

async function schemaRelationExists(executor: QueryExecutor, relation: string) {
  const rows = (await executor.unsafe(
    "SELECT to_regclass($1)::text AS relation_name",
    [relation],
  )) as QueryRow[];
  return Boolean(rows[0]?.relation_name);
}

function schemaVersionIsCurrent(executor: QueryExecutor) {
  return schemaVersionExists(executor, VERCEL_SCHEMA_VERSION);
}

async function reconcileVercelSchema() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sql = getSqlClient();
    try {
      await withDatabaseTimeout(
        (async () => {
          // Almost every request runs against an already-current schema. Check
          // that first without opening a transaction or waiting for the global
          // migration lock.
          if (await schemaVersionIsCurrent(sql as unknown as QueryExecutor)) {
            return;
          }
          await sql.begin(async (transaction) => {
            await transaction.unsafe("SELECT pg_advisory_xact_lock(7053990602)");
            if (
              await schemaVersionIsCurrent(
                transaction as unknown as QueryExecutor,
              )
            ) {
              return;
            }
            const baseSchemaIsReady = await schemaVersionExists(
              transaction as unknown as QueryExecutor,
              VERCEL_BASE_SCHEMA_VERSION,
            );
            const previousSchemaIsReady = await schemaVersionExists(
              transaction as unknown as QueryExecutor,
              VERCEL_PREVIOUS_SCHEMA_VERSION,
            );
            const complexProjectSchemaIsReady = await schemaRelationExists(
              transaction as unknown as QueryExecutor,
              "public.complex_projects",
            );
            await transaction.unsafe(
              previousSchemaIsReady || complexProjectSchemaIsReady
                ? VERCEL_LOCAL_AUTH_SCHEMA_SQL
                : baseSchemaIsReady
                ? VERCEL_INCREMENTAL_SCHEMA_SQL
                : VERCEL_SCHEMA_SQL,
            );
          });
        })(),
        DATABASE_SCHEMA_TIMEOUT_MS,
      );
      return;
    } catch (error) {
      if (isDatabaseUnavailableError(error)) {
        await recycleSqlClient(sql);
        throw error;
      }
      if (attempt === 0 && isRetryableConnectionReset(error)) {
        await recycleSqlClient(sql);
        continue;
      }
      throw error;
    }
  }
}

function ensureVercelSchemaReady() {
  if (!globalDatabase.whizzupSchemaReady) {
    globalDatabase.whizzupSchemaReady = reconcileVercelSchema()
      .catch((error) => {
        globalDatabase.whizzupSchemaReady = undefined;
        throw error;
      });
  }
  return globalDatabase.whizzupSchemaReady;
}

async function executeDirectQuery<T extends QueryRow>(
  query: string,
  parameters: unknown[],
  canRetry: boolean,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sql = getSqlClient();
    try {
      return (await withDatabaseTimeout(
        sql.unsafe(query, parameters as never[]),
        DATABASE_QUERY_TIMEOUT_MS,
      )) as PostgresResult<T>;
    } catch (error) {
      if (isDatabaseUnavailableError(error)) {
        await recycleSqlClient(sql);
        throw error;
      }
      if (isRetryableConnectionReset(error)) {
        await recycleSqlClient(sql);
        if (canRetry && attempt === 0) continue;
      }
      throw error;
    }
  }
  throw new DatabaseConnectionTimeoutError();
}

export function normalizeSqlForPostgres(query: string) {
  if (/^\s*PRAGMA\s+optimize\s*;?\s*$/i.test(query)) {
    return "SELECT 1";
  }

  const tableInfo = query.match(
    /^\s*PRAGMA\s+table_info\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*;?\s*$/i,
  );
  if (tableInfo) {
    return `SELECT
      column_name AS name,
      data_type AS type,
      CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
      column_default AS dflt_value,
      CASE WHEN position('nextval' in COALESCE(column_default, '')) > 0 THEN 1 ELSE 0 END AS pk
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '${tableInfo[1]}'
    ORDER BY ordinal_position`;
  }

  let normalized = query
    .replace(
      /\bid\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi,
      "id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
    )
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, "INSERT INTO")
    .replace(
      /\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi,
      "INSERT INTO",
    )
    .replace(/\s+COLLATE\s+NOCASE/gi, "")
    .replace(
      /datetime\(\s*'now'\s*,\s*'-35 seconds'\s*\)/gi,
      "(CURRENT_TIMESTAMP - INTERVAL '35 seconds')",
    )
    .replace(
      /date\(\s*'now'\s*,\s*'-7 day'\s*\)/gi,
      "(CURRENT_DATE - INTERVAL '7 days')::date",
    )
    .replace(/datetime\(\s*'now'\s*\)/gi, "CURRENT_TIMESTAMP")
    .replace(/datetime\(([^)]+)\)/gi, "($1)::timestamptz")
    .replace(
      /STRFTIME\(\s*'%Y'\s*,\s*'now'\s*\)/gi,
      "EXTRACT(YEAR FROM CURRENT_DATE)",
    )
    .replace(
      /json_valid\(COALESCE\(([^,]+),\s*''\)\)/gi,
      "(COALESCE($1, '') ~ '^\\s*[\\[{]')",
    )
    .replace(/json_array_length\(([^)]+)\)/gi, "jsonb_array_length(($1)::jsonb)")
    .replace(/\bjson_array\(/gi, "jsonb_build_array(")
    .replace(/\bjson_object\(/gi, "jsonb_build_object(")
    .replace(
      /\)\)\s+END AS canonical_budgets_json/gi,
      "))::text END AS canonical_budgets_json",
    )
    .replace(/\bNOT\s+GLOB\s+'\*\[0-9\]\*'/gi, "!~ '[0-9]'")
    .replace(/\bGLOB\s+'\*\[0-9\]\*'/gi, "~ '[0-9]'")
    .replace(
      /\bFROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*'([^']+)'/gi,
      "FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$1'",
    )
    .replace(
      /^\s*SELECT\s+name\s+FROM\s+information_schema\.tables/i,
      "SELECT table_name AS name FROM information_schema.tables",
    )
    .replace(
      /SUBSTR\(COALESCE\(NULLIF\(a\.created_at,\s*''\),\s*a\.activity_date\),\s*1,\s*10\)/gi,
      "SUBSTR(COALESCE(a.created_at::text, a.activity_date::text), 1, 10)",
    )
    .replace(
      /GROUP_CONCAT\(TRIM\(ei\.product_name\),\s*' · '\)/gi,
      "STRING_AGG(TRIM(ei.product_name)::text, ' · ')",
    )
    .replace(
      /GROUP_CONCAT\(a\.alias_name,\s*' \| '\)/gi,
      "STRING_AGG(a.alias_name::text, ' | ')",
    )
    .replace(
      /SUBSTR\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*,/gi,
      "SUBSTR($1::text,",
    )
    .replace(
      /\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)/gi,
      "ADD COLUMN IF NOT EXISTS ",
    );

  const wasInsertOrIgnore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(query);
  if (wasInsertOrIgnore && !/\bON\s+CONFLICT\b/i.test(normalized)) {
    normalized = normalized.replace(/;?\s*$/, " ON CONFLICT DO NOTHING");
  }

  let parameterIndex = 0;
  return normalized
    .replace(/\?/g, () => `$${++parameterIndex}`);
}

class PreparedStatement {
  constructor(
    private readonly query: string,
    private readonly parameters: unknown[] = [],
    private readonly executor?: QueryExecutor,
  ) {}

  bind(...parameters: unknown[]) {
    return new PreparedStatement(this.query, parameters, this.executor);
  }

  private async execute<T extends QueryRow>(executor?: QueryExecutor) {
    if (!executor && !this.executor) {
      await ensureVercelSchemaReady();
    }
    const normalizedQuery = normalizeSqlForPostgres(this.query);
    if (!executor && !this.executor) {
      return executeDirectQuery<T>(
        normalizedQuery,
        this.parameters,
        /^\s*(SELECT|WITH)\b/i.test(normalizedQuery),
      );
    }
    const queryExecutor =
      executor ??
      this.executor ??
      (getSqlClient() as unknown as QueryExecutor);
    const rows = (await queryExecutor.unsafe(
      normalizedQuery,
      this.parameters,
    )) as PostgresResult<T>;
    return rows;
  }

  async all<T extends QueryRow = QueryRow>(): Promise<D1Result<T & QueryRow>> {
    const rows = await this.execute<T>();
    return {
      results: Array.from(rows, normalizeD1Row),
      success: true,
      meta: { changes: Number(rows.count ?? rows.length ?? 0) },
    };
  }

  async first<T extends QueryRow = QueryRow>(): Promise<(T & QueryRow) | null> {
    const rows = await this.execute<T>();
    return rows[0] ? normalizeD1Row(rows[0]) : null;
  }

  async run(): Promise<D1Result> {
    const rows = await this.execute();
    return {
      results: Array.from(rows, normalizeD1Row),
      success: true,
      meta: { changes: Number(rows.count ?? rows.length ?? 0) },
    };
  }

  async executeIn(executor: QueryExecutor): Promise<D1Result> {
    const rows = await this.execute(executor);
    return {
      results: Array.from(rows, normalizeD1Row),
      success: true,
      meta: { changes: Number(rows.count ?? rows.length ?? 0) },
    };
  }
}

class PostgresDatabase {
  constructor(private readonly executor?: QueryExecutor) {}

  prepare(query: string) {
    return new PreparedStatement(query, [], this.executor);
  }

  async batch(statements: PreparedStatement[]) {
    if (this.executor) {
      const results: D1Result[] = [];
      for (const statement of statements) {
        results.push(await statement.executeIn(this.executor));
      }
      return results;
    }

    await ensureVercelSchemaReady();
    const sql = getSqlClient();
    return sql.begin(async (transaction) => {
      const executor = transaction as unknown as QueryExecutor;
      const results: D1Result[] = [];
      for (const statement of statements) {
        results.push(await statement.executeIn(executor));
      }
      return results;
    });
  }

  async transaction<T>(
    operation: (transaction: PostgresDatabase) => Promise<T>,
  ): Promise<T> {
    if (this.executor) return operation(this);

    await ensureVercelSchemaReady();
    const sql = getSqlClient();
    return sql.begin(async (transaction) =>
      operation(
        new PostgresDatabase(transaction as unknown as QueryExecutor),
      ),
    ) as Promise<T>;
  }
}

declare global {
  type D1Database = PostgresDatabase;
}

const database = new PostgresDatabase();

export function getD1() {
  return database;
}

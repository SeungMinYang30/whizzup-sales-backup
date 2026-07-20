import postgres from "postgres";
import {
  VERCEL_SCHEMA_SQL,
  VERCEL_SCHEMA_VERSION,
} from "./vercel-schema";

type QueryRow = Record<string, unknown>;

export type D1Result<T extends QueryRow = QueryRow> = {
  results: T[];
  success: true;
  meta: {
    changes: number;
  };
};

type QueryExecutor = {
  unsafe: (query: string, parameters?: unknown[]) => Promise<unknown>;
};

type PostgresResult<T extends QueryRow = QueryRow> = T[] & {
  count?: number;
};

const globalDatabase = globalThis as typeof globalThis & {
  whizzupPostgres?: ReturnType<typeof postgres>;
  whizzupSchemaReady?: Promise<void>;
};

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
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
      max_lifetime: 300,
      connection: {
        statement_timeout: 12000,
        lock_timeout: 5000,
        idle_in_transaction_session_timeout: 15000,
      },
    });
  }
  return globalDatabase.whizzupPostgres;
}

function ensureVercelSchemaReady() {
  if (!globalDatabase.whizzupSchemaReady) {
    globalDatabase.whizzupSchemaReady = (async () => {
      const sql = getSqlClient();
      const migrationTable = (await sql.unsafe(
        "SELECT to_regclass('public.vercel_schema_migrations')::text AS relation_name",
      )) as QueryRow[];
      if (migrationTable[0]?.relation_name) {
        const current = (await sql.unsafe(
          `SELECT 1 AS current
           FROM public.vercel_schema_migrations
           WHERE version = $1
           LIMIT 1`,
          [VERCEL_SCHEMA_VERSION],
        )) as QueryRow[];
        if (current.length > 0) return;
      }
      await sql.unsafe(VERCEL_SCHEMA_SQL);
    })()
      .catch((error) => {
        globalDatabase.whizzupSchemaReady = undefined;
        throw error;
      });
  }
  return globalDatabase.whizzupSchemaReady;
}

export function normalizeSqlForPostgres(query: string) {
  let parameterIndex = 0;
  return query
    .replace(/\s+COLLATE\s+NOCASE/gi, "")
    .replace(
      /datetime\(\s*'now'\s*,\s*'-35 seconds'\s*\)/gi,
      "(CURRENT_TIMESTAMP - INTERVAL '35 seconds')",
    )
    .replace(/datetime\(([^)]+)\)/gi, "($1)::timestamptz")
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
    const queryExecutor =
      executor ??
      this.executor ??
      (getSqlClient() as unknown as QueryExecutor);
    const rows = (await queryExecutor.unsafe(
      normalizeSqlForPostgres(this.query),
      this.parameters,
    )) as PostgresResult<T>;
    return rows;
  }

  async all<T extends QueryRow = QueryRow>(): Promise<D1Result<T & QueryRow>> {
    const rows = await this.execute<T>();
    return {
      results: Array.from(rows),
      success: true,
      meta: { changes: Number(rows.count ?? rows.length ?? 0) },
    };
  }

  async first<T extends QueryRow = QueryRow>(): Promise<(T & QueryRow) | null> {
    const rows = await this.execute<T>();
    return rows[0] ?? null;
  }

  async run(): Promise<D1Result> {
    const rows = await this.execute();
    return {
      results: Array.from(rows),
      success: true,
      meta: { changes: Number(rows.count ?? rows.length ?? 0) },
    };
  }

  async executeIn(executor: QueryExecutor): Promise<D1Result> {
    const rows = await this.execute(executor);
    return {
      results: Array.from(rows),
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

const database = new PostgresDatabase();

export function getD1() {
  return database;
}

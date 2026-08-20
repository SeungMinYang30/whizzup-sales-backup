import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type SitesDatabase = D1Database & {
  transaction<T>(operation: (database: SitesDatabase) => Promise<T>): Promise<T>;
};

let databaseProxy: SitesDatabase | null = null;

function wrapDatabase(target: D1Database): SitesDatabase {
  let proxy: SitesDatabase;
  proxy = new Proxy(target as SitesDatabase, {
    get(database, property, receiver) {
      if (property === "transaction") {
        return async <T>(
          operation: (value: SitesDatabase) => Promise<T>,
        ) => operation(proxy);
      }
      const value = Reflect.get(database, property, receiver);
      return typeof value === "function" ? value.bind(database) : value;
    },
  });
  return proxy;
}

export function getD1(): SitesDatabase {
  if (!env.DB) {
    throw new Error("데이터베이스 연결을 사용할 수 없습니다.");
  }
  if (!databaseProxy) {
    databaseProxy = wrapDatabase(env.DB);
  }
  return databaseProxy;
}

export function getReadD1(): SitesDatabase {
  if (!env.DB) {
    throw new Error("데이터베이스 연결을 사용할 수 없습니다.");
  }
  const binding = env.DB as D1Database & {
    withSession?: (constraint?: string) => unknown;
  };
  const readTarget =
    typeof binding.withSession === "function"
      ? binding.withSession("first-unconstrained")
      : binding;
  return wrapDatabase(readTarget as D1Database);
}

export function isPostgresDatabase() {
  return false;
}

export function isDatabaseUnavailableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /database.*(?:unavailable|timeout|timed out)|D1_ERROR|internal error/i.test(
    message,
  );
}

export function getDb() {
  return drizzle(getD1(), { schema });
}

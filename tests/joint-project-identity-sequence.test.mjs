import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("공동사업 PostgreSQL 자동번호는 운영 마이그레이션과 백업 복원에서 함께 보정한다", async () => {
  const [schema, backup] = await Promise.all([
    read("db/vercel-schema.ts"),
    read("lib/backup-store.ts"),
  ]);

  assert.match(schema, /202608140001_joint_project_identity_repair/);
  assert.match(schema, /202608120002_vercel_cutover_guard/);
  for (const table of [
    "joint_projects",
    "joint_project_members",
    "joint_project_events",
  ]) {
    const identityRepair = new RegExp(
      `pg_get_serial_sequence\\('public\\.${table}', 'id'\\)[\\s\\S]*?MAX\\(id\\) FROM public\\.${table}`,
    );
    assert.match(schema, identityRepair);
    assert.match(
      backup,
      new RegExp(`"${table}"[\\s\\S]*?pg_get_serial_sequence`),
    );
  }
});

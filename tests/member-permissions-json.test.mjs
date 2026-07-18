import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("member permissions are cast from serialized JSON before saving", async () => {
  const membersRoute = await readFile(
    new URL("app/api/members/route.ts", root),
    "utf8",
  );

  assert.match(membersRoute, /permissions = \?::jsonb/);
  assert.match(membersRoute, /JSON\.stringify\(permissions\)/);
});

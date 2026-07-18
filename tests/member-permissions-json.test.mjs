import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("member permissions are built as a database JSON array before saving", async () => {
  const membersRoute = await readFile(
    new URL("app/api/members/route.ts", root),
    "utf8",
  );

  assert.match(membersRoute, /jsonb_build_array/);
  assert.ok(membersRoute.includes(`"'[]'::jsonb"`));
  assert.match(membersRoute, /\.\.\.permissions/);
  assert.doesNotMatch(membersRoute, /JSON\.stringify\(permissions\)/);
});

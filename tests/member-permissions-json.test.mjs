import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("member permissions are built as a database JSON array before saving", async () => {
  const collaboration = await readFile(
    new URL("lib/collaboration.ts", root),
    "utf8",
  );
  const membersRoute = await readFile(
    new URL("app/api/members/route.ts", root),
    "utf8",
  );

  assert.match(collaboration, /jsonb_build_array/);
  assert.ok(collaboration.includes(`"'[]'::jsonb"`));
  assert.match(membersRoute, /memberPermissionsJsonExpression/);
  assert.match(membersRoute, /\.\.\.permissions/);
  assert.doesNotMatch(membersRoute, /JSON\.stringify\(permissions\)/);
});

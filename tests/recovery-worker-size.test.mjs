import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { unzipSync } from "fflate";

test("recovery source stays in static assets instead of the Worker bundle", async () => {
  const [worker, generatedSource, sourceZip] = await Promise.all([
    readFile(new URL("../dist/server/index.js", import.meta.url)),
    readFile(new URL("../lib/generated-recovery-source.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../public/recovery/WHIZZUP_source.zip",
        import.meta.url,
      ),
    ),
  ]);

  assert.ok(worker.byteLength < 10 * 1024 * 1024);
  assert.ok(generatedSource.length < 1024);
  assert.doesNotMatch(generatedSource, /RECOVERY_SOURCE_ZIP_BASE64/);

  const files = unzipSync(new Uint8Array(sourceZip));
  assert.ok(files["app/api/backup/route.ts"]);
  assert.ok(files["package.json"]);
  assert.equal(files[".env"], undefined);
});

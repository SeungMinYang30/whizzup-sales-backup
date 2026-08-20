import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/resource-pending-files.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
const { mergePendingResourceFiles } = await import(moduleUrl);

const file = (name, size, lastModified) => ({ name, size, lastModified });

test("pending resource files accumulate repeated selections and reject exact duplicates", () => {
  const first = mergePendingResourceFiles([], [file("a.pdf", 10, 1)]);
  const second = mergePendingResourceFiles(first.files, [file("b.pdf", 20, 2), file("a.pdf", 10, 1)]);
  assert.deepEqual(second.files.map((item) => item.name), ["a.pdf", "b.pdf"]);
  assert.equal(second.added, 1);
  assert.equal(second.duplicates, 1);
});
test("pending resource files distinguish changed files and cap the list at ten", () => {
  const initial = Array.from({ length: 9 }, (_, index) => file(`file-${index}.pdf`, index, index));
  const result = mergePendingResourceFiles(initial, [file("file-0.pdf", 999, 0), file("overflow.pdf", 1, 20)], 10);
  assert.equal(result.files.length, 10);
  assert.equal(result.files.at(-1).size, 999);
  assert.equal(result.overflow, 1);
});

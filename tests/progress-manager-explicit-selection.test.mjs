import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register(new URL("./typescript-resolver.mjs", import.meta.url));
const { explicitlyNamedProgressManager } = await import("../lib/progress-manager-explicit-selection.ts");

test("AI 내용에 명시된 진행 담당자만 선택한다", () => {
  const members = ["양승민 이사", "이준상 본부장"];
  assert.equal(
    explicitlyNamedProgressManager({ rawInput: "진행 담당자 이준상 본부장이야" }, members),
    "이준상 본부장",
  );
  assert.equal(
    explicitlyNamedProgressManager({ rawInput: "이준상 본부장과 미팅했습니다" }, members),
    "",
  );
  assert.equal(
    explicitlyNamedProgressManager({ rawInput: "내부 담당: 양승민" }, members),
    "양승민 이사",
  );
});

test("최신 작성자를 진행 담당자로 자동 지정하는 쿼리는 제거되어 있다", async () => {
  const source = await readFile(new URL("../lib/sales-manager-normalization.ts", import.meta.url), "utf8");
  const listSource = source.slice(
    source.indexOf("async function listBusinessProgressManagerSources"),
    source.indexOf("function prepareBusinessProgressManagerUpdate"),
  );
  assert.doesNotMatch(listSource, /activity_authors/);
  assert.match(source, /progress_manager_repair_backups/);
});

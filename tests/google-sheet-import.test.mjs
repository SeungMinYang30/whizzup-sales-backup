import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./typescript-resolver.mjs", import.meta.url));

const { parseGoogleSheetCsv, buildGoogleSheetImportRows } = await import(
  "../lib/google-sheet-import.ts"
);

test("구글 시트의 제목 행을 찾고 같은 지역의 기관명 변형을 한 건으로 묶는다", () => {
  const csv = [
    '"가상현실 스포츠실\n계약 진행 내역",,,',
    ',,수식 수정 금지,',
    ",,,",
    "지역,학교명,계약 일자,판매내용",
    "충남 천안,오성초등학교,2024-01-01,조성공사",
    "충남 천안,천안오성초등학교,2024-01-01,조성공사",
    "충남 천안,천안오성초등학교,,교구 추가 구매",
    "경기 성남,혜은학교,2023-03-02,리모델링",
  ].join("\n");

  const result = buildGoogleSheetImportRows(parseGoogleSheetCsv(csv), {
    spreadsheetId: "sheet-test",
    gid: "123",
  });

  assert.equal(result.headerRow, 4);
  assert.equal(result.sourceRows.length, 4);
  assert.equal(result.importRows.length, 2);
  assert.equal(result.duplicateRowCount, 1);

  const osung = result.importRows.find((row) =>
    row.values.organization.includes("오성초등학교"),
  );
  assert.ok(osung);
  assert.equal(osung.values.activityDate, "2024-01-01");
  assert.equal(osung.errors.length, 0);
  assert.match(osung.values.summary, /교구 추가 구매/);
  assert.match(osung.values.sourceChat, /^구글 시트 연동\|sheet-test\|123\|/);
});

test("유효한 계약 일자가 없는 기관은 저장 전에 확인 대상으로 둔다", () => {
  const csv = [
    "지역,기관명,계약일,판매내용",
    "경기 성남,테스트복지관,-,장비 점검",
  ].join("\n");
  const result = buildGoogleSheetImportRows(parseGoogleSheetCsv(csv), {
    spreadsheetId: "sheet-test",
    gid: "",
  });

  assert.equal(result.invalidDateCount, 1);
  assert.equal(result.importRows.length, 1);
  assert.equal(result.importRows[0].values.activityDate, "");
  assert.deepEqual(result.importRows[0].errors, ["계약 일자를 확인해 주세요."]);
});

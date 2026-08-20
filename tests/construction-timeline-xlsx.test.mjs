import assert from "node:assert/strict";
import test from "node:test";

import { strFromU8, unzipSync } from "fflate";
import { downloadConstructionTimelineXlsx } from "../app/activity-xlsx";
import { getConstructionTimelineDays } from "../lib/construction-calendar";

test("시공·납품 일정표 엑셀은 유효한 스타일 번호와 화면 기준 서식을 사용한다", async () => {
  let capturedBlob;
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  globalThis.document = {
    body: { appendChild() {} },
    createElement() {
      return {
        href: "",
        download: "",
        click() {},
        remove() {},
      };
    },
  };
  URL.createObjectURL = (blob) => {
    capturedBlob = blob;
    return "blob:construction-timeline-test";
  };
  URL.revokeObjectURL = () => {};

  try {
    const days = getConstructionTimelineDays("2026-08-01", 5, "2026-08-03");
    downloadConstructionTimelineXlsx({
      filename: "시공납품일정.xlsx",
      startDate: days[0].date,
      endDate: days.at(-1).date,
      headers: ["지역", "기관명", "공사·품목", "담당자", ...days.map((day) => day.label)],
      rows: [["경기 김포", "김포 모담초중학교\n1차 사업", "가상스포츠실", "양승민 이사", "출고", "", "목공", "", "검수"]],
      widths: [14, 28, 30, 16, ...days.map(() => 15)],
      fixedColumnCount: 4,
      days,
      filterSummary: "검색: 김포 & 완료 기관 제외",
    });
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }

  assert.ok(capturedBlob instanceof Blob);
  const files = unzipSync(new Uint8Array(await capturedBlob.arrayBuffer()));
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const styles = strFromU8(files["xl/styles.xml"]);

  assert.match(sheet, /xSplit="4" ySplit="2"/);
  assert.match(sheet, /orientation="landscape" fitToWidth="1"/);
  assert.match(sheet, /완료 기관 제외/);
  assert.match(sheet, /8\. 2\. \(일\)/);
  assert.match(sheet, /오늘/);
  assert.match(styles, /<cellXfs count="30">/);

  const autoFilterIndex = sheet.indexOf("<autoFilter");
  const mergeCellsIndex = sheet.indexOf("<mergeCells");
  assert.ok(autoFilterIndex >= 0, "엑셀 자동 필터가 생성되어야 한다");
  assert.ok(mergeCellsIndex >= 0, "제목 병합 셀이 생성되어야 한다");
  assert.ok(
    autoFilterIndex < mergeCellsIndex,
    "Excel OOXML 순서에 맞게 자동 필터가 병합 셀보다 먼저 와야 한다",
  );

  const styleCount = Number(styles.match(/<cellXfs count="(\d+)">/)?.[1] ?? 0);
  const styleIndexes = [...sheet.matchAll(/\ss="(\d+)"/g)].map((match) => Number(match[1]));
  assert.ok(styleIndexes.length > 0);
  assert.ok(styleIndexes.every((index) => index >= 0 && index < styleCount));
});

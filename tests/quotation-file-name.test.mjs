import assert from "node:assert/strict";
import test from "node:test";

const {
  QUOTATION_LIBRARY_FOLDER,
  QUOTATION_LIBRARY_FOLDER_SEGMENTS,
  QUOTATION_LIBRARY_PATH,
  quotationDownloadName,
  quotationFileStem,
  quotationInstitutionFolderSegments,
  quotationSourceFileName,
} = await import("../lib/quotation-file-name.ts");

test("quotation filenames sort by institution, project, round, number and file kind", () => {
  const quote = {
    region: "경남 남해",
    organization: "남해군 꿈나눔센터",
    businessRound: 1,
    projectTitle: "가상현실스포츠실",
    quoteDate: "2026-08-12",
    quoteNumber: "WZ-001",
    revisionNumber: 0,
  };
  assert.equal(QUOTATION_LIBRARY_FOLDER, "견적서");
  assert.deepEqual(QUOTATION_LIBRARY_FOLDER_SEGMENTS, ["견적서 전체"]);
  assert.equal(QUOTATION_LIBRARY_PATH, "견적서 전체");
  assert.deepEqual(quotationInstitutionFolderSegments(quote), ["01_기관자료", "경남 남해", "남해군 꿈나눔센터", "견적서", "1차 사업", "2026"]);
  assert.equal(quotationFileStem(quote), "[경남-남해] 남해군 꿈나눔센터_가상현실스포츠실_1차_WZ-001");
  assert.equal(quotationDownloadName(quote, "xlsx"), "[경남-남해] 남해군 꿈나눔센터_가상현실스포츠실_1차_WZ-001_02_위즈업견적.xlsx");
  assert.equal(quotationDownloadName(quote, "pdf"), "[경남-남해] 남해군 꿈나눔센터_가상현실스포츠실_1차_WZ-001_03_위즈업견적.pdf");
  assert.equal(quotationSourceFileName(quote, "에어패스 견적서.xlsx"), "[경남-남해] 남해군 꿈나눔센터_가상현실스포츠실_1차_WZ-001_01_외부원본_에어패스 견적서.xlsx");
});

test("quotation filenames omit empty fields and sanitize Windows characters", () => {
  assert.equal(quotationFileStem({
    organization: "광주/복지관",
    projectTitle: "",
    quoteDate: "2026-08-12",
    revisionNumber: 2,
  }), "광주_복지관_사업미지정_1차_2026-08-12");
  assert.equal(quotationFileStem({ quoteNumber: "WZ:TEST" }), "기관미지정_사업미지정_1차_WZ_TEST");
});

test("source filename normalization is idempotent and preserves its extension", () => {
  const quote = { organization: "도수초등학교", projectTitle: "가상현실스포츠실", businessRound: 1, quoteNumber: "WZ-9" };
  const first = quotationSourceFileName(quote, "외부 원본.pdf");
  assert.equal(quotationSourceFileName(quote, first), first);
});

import assert from "node:assert/strict";
import test from "node:test";

const { quotationDownloadName, quotationFileStem } = await import("../lib/quotation-file-name.ts");

test("quotation filenames use institution, project and date", () => {
  const quote = {
    organization: "함양군청",
    projectTitle: "공간재구조화 사업",
    quoteDate: "2026-08-12",
    quoteNumber: "WZ-20260812-ABCD",
    revisionNumber: 0,
  };
  assert.equal(quotationFileStem(quote), "견적서_함양군청_공간재구조화 사업_2026-08-12");
  assert.equal(quotationDownloadName(quote, "pdf"), "견적서_함양군청_공간재구조화 사업_2026-08-12.pdf");
  assert.equal(quotationDownloadName(quote, "xlsx"), "견적서_함양군청_공간재구조화 사업_2026-08-12.xlsx");
});

test("quotation filenames omit empty fields, sanitize Windows characters and mark revisions", () => {
  assert.equal(quotationFileStem({
    organization: "광주/복지관",
    projectTitle: "",
    quoteDate: "2026-08-12",
    revisionNumber: 2,
  }), "견적서_광주_복지관_2026-08-12_수정2");
  assert.equal(quotationFileStem({ quoteNumber: "WZ:TEST" }), "견적서_WZ_TEST");
});

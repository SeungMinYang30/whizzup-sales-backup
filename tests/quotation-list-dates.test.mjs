import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { originalQuotationDateByRoot, quotationListDateLabels } from "../lib/quotation-list-dates.ts";

test("견적 목록은 원본 견적일과 실제 수정본 생성일을 구분한다", () => {
  const quotes = [
    { id: 10, revisionRootId: 10, revisionNumber: 0, quoteDate: "2026-08-14", createdAt: "2026-08-14 02:00:00" },
    { id: 11, revisionRootId: 10, revisionNumber: 1, quoteDate: "2026-08-16", createdAt: "2026-08-15 16:30:00" },
  ];
  const labels = quotationListDateLabels(quotes[1], originalQuotationDateByRoot(quotes));
  assert.deepEqual(labels, { initialDate: "2026-08-14", modifiedDate: "2026-08-16" });
});

test("수정본이 아닌 견적은 수정일을 표시하지 않는다", () => {
  const quote = { id: 20, revisionRootId: 20, revisionNumber: 0, quoteDate: "2026-08-16", createdAt: "2026-08-16T03:00:00Z" };
  assert.deepEqual(quotationListDateLabels(quote, originalQuotationDateByRoot([quote])), { initialDate: "2026-08-16", modifiedDate: "" });
});

test("같은 견적번호를 직접 수정한 경우 내용 수정일을 표시한다", () => {
  const quote = { id: 30, revisionRootId: 30, revisionNumber: 0, initialQuoteDate: "2026-08-14", quoteDate: "2026-08-16", createdAt: "2026-08-14T03:00:00Z", contentUpdatedAt: "2026-08-15 16:05:00" };
  assert.deepEqual(quotationListDateLabels(quote, originalQuotationDateByRoot([quote])), { initialDate: "2026-08-14", modifiedDate: "2026-08-16" });
});

test("파일 동기화 시간과 별도로 내용 수정일을 기록한다", () => {
  const store = fs.readFileSync(new URL("../lib/authored-quotations.ts", import.meta.url), "utf8");
  assert.match(store, /initial_quote_date TEXT NOT NULL DEFAULT ''/u);
  assert.match(store, /initial_quote_date=CASE WHEN initial_quote_date='' THEN quote_date ELSE initial_quote_date END/u);
  assert.match(store, /content_updated_at=CASE WHEN status='final' THEN CAST\(CURRENT_TIMESTAMP AS TEXT\) ELSE content_updated_at END/u);
  assert.doesNotMatch(store, /THEN CURRENT_TIMESTAMP ELSE content_updated_at/u);
});

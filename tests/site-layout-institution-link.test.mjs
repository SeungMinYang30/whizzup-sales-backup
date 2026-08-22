import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [planner, institutionsRoute, documentsCard] = await Promise.all([
  read("app/site-layout-planner-page.tsx"),
  read("app/api/institutions/route.ts"),
  read("app/organization-project-documents-card.tsx"),
]);

test("기관 검색 결과가 없으면 새 기관을 추가하고 현재 도면에 바로 연결한다", () => {
  assert.match(planner, /async function createInstitutionFromDraft\(\)/);
  assert.match(planner, /fetch\("\/api\/institutions", \{ method: "POST"/);
  assert.match(planner, /새 기관으로 추가/);
  assert.match(institutionsRoute, /export async function POST\(request: Request\)/);
  assert.match(institutionsRoute, /INSERT INTO institution_registry/);
  assert.match(institutionsRoute, /ON CONFLICT\(organization\) DO UPDATE SET/);
});

test("기관 상세 도면·조감도는 같은 저장본의 기초도면 PDF와 원본을 중복 저장 없이 표시한다", () => {
  assert.match(documentsCard, /const documentFilters = \["전체", "기초도면", "도면", "조감도", "통합본", "기타"\]/);
  assert.match(documentsCard, /fetch\(`\/api\/site-layouts\?q=\$\{encodeURIComponent\(organization\)\}`/);
  assert.match(documentsCard, /layout\.organizationName === organization && Number\(layout\.businessRound\) === businessRound/);
  assert.match(documentsCard, /layout\.pdfUrl/);
  assert.match(documentsCard, /PDF 다운로드/);
  assert.match(documentsCard, /layout\.jsonUrl/);
  assert.doesNotMatch(documentsCard, /deleteSiteLayout|DELETE.*site-layouts/s);
});

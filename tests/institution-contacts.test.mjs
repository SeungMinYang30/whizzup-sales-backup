import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeInstitutionContacts,
  primaryInstitutionContact,
} from "../lib/institution-contacts.ts";

test("기관 담당자를 여러 명 저장하고 주 담당자는 한 명만 유지한다", () => {
  const contacts = normalizeInstitutionContacts([
    {
      role: "교감",
      name: "김선생",
      phone: "010-1111-2222",
      email: "first@example.com",
      primary: true,
    },
    {
      role: "공사 담당",
      name: "이선생",
      phone: "010-3333-4444",
      email: "second@example.com",
      primary: true,
    },
  ]);

  assert.equal(contacts.length, 2);
  assert.equal(contacts.filter((contact) => contact.primary).length, 1);
  assert.equal(primaryInstitutionContact(contacts).email, "first@example.com");
});

test("기존 단일 담당자 기록도 연락처 목록으로 호환한다", () => {
  const contacts = normalizeInstitutionContacts("[]", {
    role: "행정실",
    name: "박주무관",
    phone: "02-123-4567",
    email: "legacy@example.com",
  });

  assert.deepEqual(contacts, [
    {
      role: "행정실",
      name: "박주무관",
      phone: "02-123-4567",
      email: "legacy@example.com",
      primary: true,
    },
  ]);
});

test("담당자 목록은 DB와 등록 화면 양쪽에 연결된다", async () => {
  const [schema, store, route, screen] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/records-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /contactsJson: text\("contacts_json"\)/);
  assert.match(store, /serializeInstitutionContacts\(inheritedPayload\.contacts/);
  assert.match(route, /contacts_json = \?/);
  assert.match(screen, /\+ 담당자 추가/);
  assert.match(screen, /name="primary-institution-contact"/);
});

test("연결된 품목은 제품 목록의 기준 명칭으로 표시하고 저장한다", async () => {
  const route = await readFile(
    new URL("../app/api/equipment/route.ts", import.meta.url),
    "utf8",
  );
  const screen = await readFile(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(route, /readCanonicalProductMap/);
  assert.match(route, /product_name: canonical\.name/);
  assert.match(route, /if \(canonicalProduct\) productName = canonicalProduct\.name/);
  assert.match(screen, /linkedProduct\?\.name \?\? item\.productName/);
});

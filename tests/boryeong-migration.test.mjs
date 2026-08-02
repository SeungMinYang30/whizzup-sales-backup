import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("보령 실버복지관의 기존 별칭과 연결 데이터를 한 기관으로 합친다", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY, region TEXT, organization TEXT, topic TEXT,
      summary TEXT, next_action TEXT, progress_schedule TEXT, notes TEXT,
      updated_at TEXT
    );
    CREATE TABLE ai_recommendations (
      id INTEGER PRIMARY KEY, activity_id INTEGER, organization TEXT,
      meeting_summary TEXT, updated_at TEXT
    );
    CREATE TABLE organization_locations (
      organization TEXT PRIMARY KEY, updated_at TEXT
    );
    CREATE TABLE manager_alert_acknowledgements (
      id INTEGER PRIMARY KEY, member_id INTEGER, organization TEXT,
      updated_at TEXT, UNIQUE(member_id, organization)
    );
    CREATE TABLE sales_campaign_targets (
      id INTEGER PRIMARY KEY, campaign_id INTEGER, organization TEXT,
      updated_at TEXT, UNIQUE(campaign_id, organization)
    );
    CREATE TABLE equipment_projects (
      id INTEGER PRIMARY KEY, organization TEXT, name TEXT, updated_at TEXT,
      UNIQUE(organization, name)
    );
    CREATE TABLE equipment_items (id INTEGER PRIMARY KEY, project_id INTEGER);

    INSERT INTO activities VALUES (
      1, '충남 보령', '보령시 실버복지관', '보령시 실버복지관 스크린',
      '보령시 실버복지관과 논의했다.', '', '', '', ''
    );
    INSERT INTO ai_recommendations VALUES (
      1, 1, '보령시 실버복지관', '보령시 실버복지관과 논의했다.', ''
    );
    INSERT INTO organization_locations VALUES ('보령 실버복지관', '');
    INSERT INTO organization_locations VALUES ('보령시 실버복지관', '');
    INSERT INTO manager_alert_acknowledgements VALUES (1, 7, '보령 실버복지관', '');
    INSERT INTO manager_alert_acknowledgements VALUES (2, 7, '보령시 실버복지관', '');
    INSERT INTO sales_campaign_targets VALUES (1, 3, '보령 실버복지관', '');
    INSERT INTO sales_campaign_targets VALUES (2, 3, '보령시 실버복지관', '');
    INSERT INTO equipment_projects VALUES (1, '보령 실버복지관', '스크린', '');
    INSERT INTO equipment_projects VALUES (2, '보령시 실버복지관', '스크린', '');
    INSERT INTO equipment_items VALUES (1, 2);
  `);

  const migration = await readFile(
    new URL("../drizzle/0020_merge-boryeong-silver-welfare.sql", import.meta.url),
    "utf8",
  );
  migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .forEach((statement) => db.exec(statement));

  const activity = db
    .prepare("SELECT organization, summary FROM activities WHERE id = 1")
    .get();
  assert.equal(activity.organization, "보령 실버복지관");
  assert.match(activity.summary, /^보령 실버복지관/);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM organization_locations").get()
      .count,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM manager_alert_acknowledgements").get()
      .count,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sales_campaign_targets").get()
      .count,
    1,
  );
  assert.equal(
    db.prepare("SELECT project_id FROM equipment_items WHERE id = 1").get()
      .project_id,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM equipment_projects").get().count,
    1,
  );
});

test("잘못 합쳐진 명천초등학교 병설유치원 기록만 원래 기관으로 되돌린다", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY, activity_date TEXT, region TEXT,
      organization TEXT, topic TEXT, summary TEXT, next_action TEXT,
      progress_schedule TEXT, notes TEXT, updated_at TEXT
    );
    CREATE TABLE ai_recommendations (
      id INTEGER PRIMARY KEY, activity_id INTEGER, organization TEXT,
      meeting_summary TEXT, updated_at TEXT
    );

    INSERT INTO activities VALUES (
      1, '2026-07-20', '보령', '보령 실버복지관', '스크린 사이즈 통일',
      '보령 실버복지관은 스크린 사이즈를 통일하기로 했습니다.', '', '', '', ''
    );
    INSERT INTO activities VALUES (
      2, '2026-07-20', '보령', '보령 실버복지관', '스크린 사이즈 통일',
      '보령 명천초등학교 병설유치원은 스크린 사이즈를 통일하기로 했습니다.',
      '', '', '', ''
    );
    INSERT INTO ai_recommendations VALUES (
      1, 1, '보령 실버복지관', '보령 실버복지관 스크린 검토', ''
    );
    INSERT INTO ai_recommendations VALUES (
      2, 2, '보령 실버복지관', '보령 실버복지관 스크린 검토', ''
    );
  `);

  const migration = await readFile(
    new URL(
      "../drizzle/0021_restore-boryeong-myeongcheon-kindergarten.sql",
      import.meta.url,
    ),
    "utf8",
  );
  migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .forEach((statement) => db.exec(statement));

  assert.equal(
    db.prepare("SELECT organization FROM activities WHERE id = 1").get()
      .organization,
    "보령 실버복지관",
  );
  assert.equal(
    db.prepare("SELECT organization FROM activities WHERE id = 2").get()
      .organization,
    "보령 명천초등학교 병설유치원",
  );
  const recommendation = db
    .prepare(
      "SELECT organization, meeting_summary FROM ai_recommendations WHERE activity_id = 2",
    )
    .get();
  assert.equal(
    recommendation.organization,
    "보령 명천초등학교 병설유치원",
  );
  assert.match(recommendation.meeting_summary, /명천초등학교 병설유치원/);
});

test("보령 명천실버복지관의 모든 연결 기록을 명천 실버복지관으로 합친다", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY, region TEXT, organization TEXT, topic TEXT,
      summary TEXT, next_action TEXT, progress_schedule TEXT, notes TEXT,
      updated_at TEXT
    );
    CREATE TABLE ai_recommendations (
      id INTEGER PRIMARY KEY, activity_id INTEGER, organization TEXT,
      meeting_summary TEXT, updated_at TEXT
    );
    CREATE TABLE organization_locations (
      organization TEXT PRIMARY KEY, updated_at TEXT
    );
    CREATE TABLE manager_alert_acknowledgements (
      id INTEGER PRIMARY KEY, member_id INTEGER, organization TEXT,
      updated_at TEXT, UNIQUE(member_id, organization)
    );
    CREATE TABLE sales_campaign_targets (
      id INTEGER PRIMARY KEY, campaign_id INTEGER, organization TEXT,
      updated_at TEXT, UNIQUE(campaign_id, organization)
    );
    CREATE TABLE equipment_projects (
      id INTEGER PRIMARY KEY, organization TEXT, name TEXT, updated_at TEXT,
      UNIQUE(organization, name)
    );
    CREATE TABLE equipment_items (id INTEGER PRIMARY KEY, project_id INTEGER);
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by INTEGER,
      updated_at TEXT
    );

    INSERT INTO activities VALUES (
      1, '충남 보령', '명천 실버복지관', '기존 일정',
      '명천 실버복지관 기존 상담 내용', '', '', '', ''
    );
    INSERT INTO activities VALUES (
      2, '보령', '보령 명천실버복지관', '추가 일정',
      '보령 명천실버복지관 수의계약 상담 내용', '', '', '', ''
    );
    INSERT INTO ai_recommendations VALUES (
      1, 2, '보령 명천실버복지관', '보령 명천실버복지관 후속 대응', ''
    );
    INSERT INTO organization_locations VALUES ('명천 실버복지관', '');
    INSERT INTO organization_locations VALUES ('보령 명천실버복지관', '');
    INSERT INTO manager_alert_acknowledgements VALUES (1, 7, '명천 실버복지관', '');
    INSERT INTO manager_alert_acknowledgements VALUES (2, 7, '보령 명천실버복지관', '');
    INSERT INTO sales_campaign_targets VALUES (1, 3, '명천 실버복지관', '');
    INSERT INTO sales_campaign_targets VALUES (2, 3, '보령 명천실버복지관', '');
    INSERT INTO equipment_projects VALUES (1, '명천 실버복지관', '스크린', '');
    INSERT INTO equipment_projects VALUES (2, '보령 명천실버복지관', '스크린', '');
    INSERT INTO equipment_items VALUES (1, 2);
    INSERT INTO app_settings VALUES ('institution_aliases', '{}', NULL, '');
  `);

  const migration = await readFile(
    new URL(
      "../drizzle/0022_merge-myeongcheon-silver-welfare.sql",
      import.meta.url,
    ),
    "utf8",
  );
  migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .forEach((statement) => db.exec(statement));

  const activities = db
    .prepare("SELECT organization, summary FROM activities ORDER BY id")
    .all();
  assert.equal(activities.length, 2);
  assert.ok(
    activities.every(
      (activity) => activity.organization === "명천 실버복지관",
    ),
  );
  assert.match(activities[1].summary, /^명천 실버복지관/);
  const recommendation = db
    .prepare(
      "SELECT organization, meeting_summary FROM ai_recommendations WHERE id = 1",
    )
    .get();
  assert.equal(recommendation.organization, "명천 실버복지관");
  assert.match(recommendation.meeting_summary, /^명천 실버복지관/);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM organization_locations").get()
      .count,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM manager_alert_acknowledgements").get()
      .count,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sales_campaign_targets").get()
      .count,
    1,
  );
  assert.equal(
    db.prepare("SELECT project_id FROM equipment_items WHERE id = 1").get()
      .project_id,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM equipment_projects").get().count,
    1,
  );
  const aliases = JSON.parse(
    db
      .prepare("SELECT value FROM app_settings WHERE key = 'institution_aliases'")
      .get().value,
  );
  assert.equal(aliases["보령명천실버복지관"], "명천 실버복지관");
  assert.equal(aliases["보령시명천실버복지관"], "명천 실버복지관");
});

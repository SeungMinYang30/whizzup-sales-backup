import { getD1, isPostgresDatabase } from "../db";
import { ensureEquipmentReady } from "./equipment-store";
import {
  CONSTRUCTION_STAGES,
  isConstructionStage,
  isValidConstructionStage,
} from "./construction-stages";
import {
  clean,
  parseProgressScheduleEntries,
  serializeProgressSchedule,
} from "./records-store";
import {
  isAllowedAiAutoSchedule,
  isApprovedShowroomAutoSchedule,
} from "./ai-auto-schedule-policy";
import { personDisplayLabel } from "./person-label";
import {
  findSimilarInstitutionNames,
  institutionAliasKey,
} from "./institution-names";

export type OrganizationSchedule = {
  id: number;
  organization: string;
  businessRound: number;
  label: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  category: string;
  stage: string;
  endDate: string;
  vendorName: string;
  details: string;
  completed: boolean;
  sourceActivityId: number | null;
  assigneeMemberId: number | null;
  assigneeName: string;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
  googleEventId: string;
  googleOrigin: boolean;
  syncStatus: "pending" | "synced" | "failed" | "local_only";
  syncOperation: "upsert" | "delete" | "unlink" | "move-construction";
  syncError: string;
  syncAttempts: number;
  lastSyncedAt: string;
};

export type OrganizationScheduleInput = {
  id?: number;
  label: string;
  scheduledDate: string;
  startTime?: string;
  endTime?: string;
  category?: string;
  completed?: boolean;
};

export type ConstructionScheduleInput = {
  id?: number;
  stage: string;
  scheduledDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  vendorName?: string;
  details?: string;
  completed?: boolean;
};

export type ConstructionScheduleProject = {
  id: number;
  organization: string;
  businessRound: number;
  workSummary: string;
  workSummaryMode: "auto" | "manual";
  sourceProductNames: string[];
  completed: boolean;
  hidden: boolean;
  updatedAt: string;
};

export type ConstructionScheduleSaveResult = {
  project: ConstructionScheduleProject;
  schedules: OrganizationSchedule[];
  syncIds: number[];
};

export type ConstructionDashboardCounts = {
  planned: number;
  active: number;
  completed: number;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS organization_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    label TEXT NOT NULL,
    scheduled_date TEXT NOT NULL,
    start_time TEXT NOT NULL DEFAULT '',
    end_time TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'general',
    stage TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    vendor_name TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    source_activity_id INTEGER,
    created_by INTEGER,
    created_by_name TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_by_name TEXT NOT NULL DEFAULT '',
    assignee_member_id INTEGER,
    assignee_name TEXT NOT NULL DEFAULT '',
    google_event_id TEXT NOT NULL DEFAULT '',
    google_event_etag TEXT NOT NULL DEFAULT '',
    google_origin INTEGER NOT NULL DEFAULT 0,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    sync_operation TEXT NOT NULL DEFAULT 'upsert',
    sync_error TEXT NOT NULL DEFAULT '',
    sync_attempts INTEGER NOT NULL DEFAULT 0,
    last_synced_at TEXT NOT NULL DEFAULT '',
    google_updated_at TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS organization_schedules_scope_date_idx
   ON organization_schedules (
     organization, business_round, completed, scheduled_date, id
   )`,
  `CREATE TABLE IF NOT EXISTS organization_schedule_import_state (
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization, business_round)
  )`,
  `CREATE TABLE IF NOT EXISTS construction_schedule_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    work_summary TEXT NOT NULL DEFAULT '',
    work_summary_mode TEXT NOT NULL DEFAULT 'auto',
    completed INTEGER NOT NULL DEFAULT 0,
    hidden_at TEXT NOT NULL DEFAULT '',
    created_by INTEGER,
    created_by_name TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization, business_round)
  )`,
];

const activeLocalScheduleIdentityIndex = "organization_schedules_active_local_identity_idx";
const activeLocalScheduleSemanticIdentityIndex = "organization_schedules_active_local_semantic_identity_idx";

function compactScheduleOrganizationSql(column: string) {
  return `REPLACE(LOWER(TRIM(${column})), ' ', '')`;
}

function administrativeFreeScheduleOrganizationSql(column: string) {
  return ["íŠ¹ë³„ìì¹˜ë„", "íŠ¹ë³„ìì¹˜ì‹œ", "ê´‘ì—­ì‹œ", "íŠ¹ë³„ì‹œ", "ë„", "ì‹œ", "êµ°", "êµ¬"]
    .reduce((expression, suffix) => `REPLACE(${expression}, '${suffix}', '')`, compactScheduleOrganizationSql(column));
}

function semanticScheduleLabelSql(organizationColumn: string, labelColumn: string) {
  const compactOrganization = compactScheduleOrganizationSql(organizationColumn);
  const administrativeFreeOrganization = administrativeFreeScheduleOrganizationSql(organizationColumn);
  const labelWithoutCategoryPrefix = `CASE
    WHEN INSTR(TRIM(${labelColumn}), ']') BETWEEN 1 AND 12
      THEN SUBSTR(TRIM(${labelColumn}), INSTR(TRIM(${labelColumn}), ']') + 1)
    ELSE TRIM(${labelColumn})
  END`;
  const compactLabel = `REPLACE(LOWER(${labelWithoutCategoryPrefix}), ' ', '')`;
  return `REPLACE(REPLACE(${compactLabel}, ${compactOrganization}, ''), ${administrativeFreeOrganization}, '')`;
}

const duplicateSemanticLabel = semanticScheduleLabelSql("duplicate.organization", "duplicate.label");
const keeperSemanticLabel = semanticScheduleLabelSql("keeper.organization", "keeper.label");

const removeDuplicateLocalSchedulesSql = `
  DELETE FROM organization_schedules
  WHERE id IN (
    SELECT duplicate.id
    FROM organization_schedules duplicate
    WHERE COALESCE(duplicate.category, 'general') <> 'construction'
      AND TRIM(COALESCE(duplicate.deleted_at, '')) = ''
      AND TRIM(COALESCE(duplicate.google_event_id, '')) = ''
      AND EXISTS (
        SELECT 1
        FROM organization_schedules keeper
        WHERE LOWER(TRIM(keeper.organization)) = LOWER(TRIM(duplicate.organization))
          AND keeper.business_round = duplicate.business_round
          AND LOWER(TRIM(keeper.label)) = LOWER(TRIM(duplicate.label))
          AND keeper.scheduled_date = duplicate.scheduled_date
          AND LOWER(TRIM(COALESCE(keeper.category, 'general'))) = LOWER(TRIM(COALESCE(duplicate.category, 'general')))
          AND COALESCE(keeper.category, 'general') <> 'construction'
          AND TRIM(COALESCE(keeper.deleted_at, '')) = ''
          AND (
            TRIM(COALESCE(keeper.google_event_id, '')) <> ''
            OR (
              TRIM(COALESCE(keeper.google_event_id, '')) = ''
              AND keeper.id < duplicate.id
            )
          )
      )
  )`;

const createActiveLocalScheduleIdentityIndexSql = `
  CREATE UNIQUE INDEX IF NOT EXISTS ${activeLocalScheduleIdentityIndex}
  ON organization_schedules (
    LOWER(TRIM(organization)),
    business_round,
    LOWER(TRIM(label)),
    scheduled_date,
    LOWER(TRIM(COALESCE(category, 'general')))
  )
  WHERE COALESCE(category, 'general') <> 'construction'
    AND TRIM(COALESCE(deleted_at, '')) = ''
    AND TRIM(COALESCE(google_event_id, '')) = ''`;

const removeSemanticallyDuplicateLocalSchedulesSql = `
  DELETE FROM organization_schedules
  WHERE id IN (
    SELECT duplicate.id
    FROM organization_schedules duplicate
    WHERE COALESCE(duplicate.category, 'general') <> 'construction'
      AND TRIM(COALESCE(duplicate.deleted_at, '')) = ''
      AND TRIM(COALESCE(duplicate.google_event_id, '')) = ''
      AND EXISTS (
        SELECT 1
        FROM organization_schedules keeper
        WHERE LOWER(TRIM(keeper.organization)) = LOWER(TRIM(duplicate.organization))
          AND keeper.business_round = duplicate.business_round
          AND ${keeperSemanticLabel} = ${duplicateSemanticLabel}
          AND keeper.scheduled_date = duplicate.scheduled_date
          AND LOWER(TRIM(COALESCE(keeper.category, 'general'))) = LOWER(TRIM(COALESCE(duplicate.category, 'general')))
          AND COALESCE(keeper.category, 'general') <> 'construction'
          AND TRIM(COALESCE(keeper.deleted_at, '')) = ''
          AND (
            TRIM(COALESCE(keeper.google_event_id, '')) <> ''
            OR (
              TRIM(COALESCE(keeper.google_event_id, '')) = ''
              AND keeper.id < duplicate.id
            )
          )
      )
  )`;

const createActiveLocalScheduleSemanticIdentityIndexSql = `
  CREATE UNIQUE INDEX IF NOT EXISTS ${activeLocalScheduleSemanticIdentityIndex}
  ON organization_schedules (
    LOWER(TRIM(organization)),
    business_round,
    ${semanticScheduleLabelSql("organization", "label")},
    scheduled_date,
    LOWER(TRIM(COALESCE(category, 'general')))
  )
  WHERE COALESCE(category, 'general') <> 'construction'
    AND TRIM(COALESCE(deleted_at, '')) = ''
    AND TRIM(COALESCE(google_event_id, '')) = ''`;

let schedulesReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function initializeOrganizationSchedules() {
  const d1 = getD1();
  if (isPostgresDatabase()) {
    // The shared Vercel schema migration owns these tables and columns. A
    // lightweight read both triggers that migration and avoids repeating DDL
    // from every cold dashboard function.
    await d1.prepare("SELECT 1").all();
    return d1;
  }
  // ì¼ì • ì¡°íšŒëŠ” HOME ì²« í™”ë©´ì—ì„œ ì—¬ëŸ¬ APIì™€ ë™ì‹œì— ì‹¤í–‰ë©ë‹ˆë‹¤. ì—¬ê¸°ì„œ
  // í™œë™ ì „ì²´ì˜ ë°ì´í„° ë³´ì •ê¹Œì§€ ê¸°ë‹¤ë¦¬ë©´ ì¼ì • ì¡°íšŒ í•˜ë‚˜ê°€ D1 ì“°ê¸° ì ê¸ˆì„
  // ì˜¤ë˜ ì¡ì•„ ë‹¤ë¥¸ ì´ˆê¸° í™”ë©´ ìš”ì²­ë„ í•¨ê»˜ ë©ˆì¶¥ë‹ˆë‹¤. ì¼ì • í…Œì´ë¸”ì€ ë…ë¦½
  // í…Œì´ë¸”ì´ë¯€ë¡œ í•„ìš”í•œ ìŠ¤í‚¤ë§ˆë§Œ ì¤€ë¹„í•˜ê³  ì¦‰ì‹œ ì½ì„ ìˆ˜ ìˆê²Œ í•©ë‹ˆë‹¤.
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
  const columns = await d1.prepare("PRAGMA table_info(organization_schedules)").all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["start_time", "TEXT NOT NULL DEFAULT ''"],
    ["end_time", "TEXT NOT NULL DEFAULT ''"],
    ["category", "TEXT NOT NULL DEFAULT 'general'"],
    ["stage", "TEXT NOT NULL DEFAULT ''"],
    ["end_date", "TEXT NOT NULL DEFAULT ''"],
    ["vendor_name", "TEXT NOT NULL DEFAULT ''"],
    ["details", "TEXT NOT NULL DEFAULT ''"],
    ["assignee_member_id", "INTEGER"],
    ["assignee_name", "TEXT NOT NULL DEFAULT ''"],
    ["google_event_id", "TEXT NOT NULL DEFAULT ''"],
    ["google_event_etag", "TEXT NOT NULL DEFAULT ''"],
    ["google_origin", "INTEGER NOT NULL DEFAULT 0"],
    ["sync_status", "TEXT NOT NULL DEFAULT 'pending'"],
    ["sync_operation", "TEXT NOT NULL DEFAULT 'upsert'"],
    ["sync_error", "TEXT NOT NULL DEFAULT ''"],
    ["sync_attempts", "INTEGER NOT NULL DEFAULT 0"],
    ["last_synced_at", "TEXT NOT NULL DEFAULT ''"],
    ["google_updated_at", "TEXT NOT NULL DEFAULT ''"],
    ["deleted_at", "TEXT NOT NULL DEFAULT ''"],
  ] as const;
  for (const [name, definition] of additions) {
    if (!names.has(name)) {
      await d1.prepare(`ALTER TABLE organization_schedules ADD COLUMN ${name} ${definition}`).run();
    }
  }
  const identityIndex = await d1.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1",
  ).bind(activeLocalScheduleIdentityIndex).first<{ name: string }>();
  if (!identityIndex) {
    // Keep the original/Google-linked row, remove only redundant local rows, then
    // let SQLite prevent concurrent requests from recreating the same schedule.
    await d1.prepare(removeDuplicateLocalSchedulesSql).run();
    await d1.prepare(createActiveLocalScheduleIdentityIndexSql).run();
  }
  const semanticIdentityIndex = await d1.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1",
  ).bind(activeLocalScheduleSemanticIdentityIndex).first<{ name: string }>();
  if (!semanticIdentityIndex) {
    // Treat minor institution-name variations inside generated titles as the
    // same schedule (for example ê´‘ì£¼/ê´‘ì£¼ì‹œ) while preserving distinct work.
    await d1.prepare(removeSemanticallyDuplicateLocalSchedulesSql).run();
    await d1.prepare(createActiveLocalScheduleSemanticIdentityIndexSql).run();
  }
  await d1.batch([
    d1.prepare(
      `CREATE INDEX IF NOT EXISTS organization_schedules_sync_idx
       ON organization_schedules (sync_status, sync_operation, updated_at, id)`,
    ),
    d1.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS organization_schedules_google_event_idx
       ON organization_schedules (google_event_id) WHERE google_event_id <> ''`,
    ),
  ]);
  const projectColumns = await d1.prepare("PRAGMA table_info(construction_schedule_projects)").all<{ name: string }>();
  if (!projectColumns.results.some((column) => column.name === "work_summary_mode")) {
    await d1.prepare("ALTER TABLE construction_schedule_projects ADD COLUMN work_summary_mode TEXT NOT NULL DEFAULT 'auto'").run();
  }
  if (!projectColumns.results.some((column) => column.name === "hidden_at")) {
    await d1.prepare("ALTER TABLE construction_schedule_projects ADD COLUMN hidden_at TEXT NOT NULL DEFAULT ''").run();
  }
  const duplicateLegacyScheduleIds = `
    SELECT legacy.id
    FROM organization_schedules legacy
    WHERE COALESCE(legacy.category, 'general') <> 'construction'
      AND legacy.source_activity_id IS NOT NULL
      AND TRIM(COALESCE(legacy.deleted_at, '')) = ''
      AND EXISTS (
        SELECT 1 FROM organization_schedules construction
        WHERE construction.organization = legacy.organization
          AND construction.business_round = legacy.business_round
          AND construction.category = 'construction'
          AND construction.source_activity_id = legacy.source_activity_id
          AND construction.stage = legacy.label
          AND construction.scheduled_date = legacy.scheduled_date
          AND COALESCE(construction.start_time, '') = COALESC×öêÚ$z{-®éÜj×—BÆ—7D÷&væ—¦F–öå66†VGVÆW2€Ğ¢–çWBæ÷&væ—¦F–öâÀĞ¢–çWBæ'W6–æW75&÷VæBÀĞ¢“°Ğ¢v—BÖ—'&÷$÷Vå66†VGVÆW5FôÆFW7D7F—f—G’€Ğ¢CÀĞ¢–çWBæ÷&væ—¦F–öâÀĞ¢–çWBæ'W6–æW75&÷VæBÀĞ¢66†VGVÆW2ÀĞ¢“°Ğ¢&WGW&â66†VGVÆW2æf–æB‚‡66†VGVÆR’Óâ66†VGVÆRæ–BÓÓÒ–çWBæ–B’óòçVÆÃ°Ğ§ĞĞ Ğ§G—R66†VGVÆT7F÷"Ò°Ğ¢–C¢çVÖ&W#°Ğ¢F—7Æ”æÖS¢7G&–æs°Ğ¢&öÆS¢&FÖ–â"Â&76—7FçB"Â&ÖVÖ&W"#°Ğ§Ó°Ğ Ğ¦7–æ2gVæ7F–öâ&WV—&TVF—F&ÆU66†VGVÆR†–EfÇVS¢Væ¶æ÷vâÂÖVÖ&W#¢66†VGVÆT7F÷"’°Ğ¢6öç7B–BÒçVÖ&W"†–EfÇVR“°Ğ¢–b‚çVÖ&W"æ—56fT–çFVvW"†–B’ÇÂ–BÃÒ’F‡&÷ræWrW'&÷"‚.È‰Ê	^ÙZÉÛÎÊ	^ÉØBÈJØ9ŞÙ[BÊ;ÎÈKÉ©Bâ"“°Ğ¢6öç7BCÒv—BVç7W&T÷&væ—¦F–öå66†VGVÆW5&VG’‚“°Ğ¢6öç7B&÷rÒv—BCç&W&R€Ğ¢4TÄT5B¢e$ôÒ÷&væ—¦F–öå÷66†VGVÆW0Ğ¢t„U$R–BÒòäBE$”Ò„4ôÄU44R†FVÆWFVEöBÂrr’’ÒrrÄ”Ô•BÀĞ¢’æ&–æB†–B’æf—'7CÅ&V6÷&CÇ7G&–ærÂVæ¶æ÷vããâ‚“°Ğ¢–b‚&÷r’F‡&÷ræWrW'&÷"‚.ÉÛÎÊ	^ÉØBËîÉØBÈ‰‚ÉxnÈ«^¸¸¸ºBâ"“°Ğ¢–b…7G&–ær‡&÷ræ6FVv÷'’óò&vVæW&Â"’ÓÓÒ&6öç7G'V7F–öâ"’°Ğ¢F‡&÷ræWrW'&÷"‚.È¹Î«;RÉÛÎÊ	^ÉØÈ¹Î«;\+~¸*Ù(‚ÉÛÎÊ	^ÙÎÉyÈIÂÈ‰Ê	^Ù[BÊ;ÎÈKÉ©Bâ"“°Ğ¢ĞĞ¢6öç7BW&Ö—GFVBÒÖVÖ&W"ç&öÆRÓÓÒ&FÖ–â Ğ¢ÇÂçVÖ&W"‡&÷ræ7&VFVEö'’’ÓÓÒÖVÖ&W"æ–@Ğ¢ÇÂçVÖ&W"‡&÷ræ76–væVUöÖVÖ&W%ö–B’ÓÓÒÖVÖ&W"æ–C°Ğ¢–b‚W&Ö—GFVB’F‡&÷ræWrW'&÷"‚.ÉéÈKÉéÂ¸»N¸»Éé¹‰¸©B«HºjÎÉéºxÂÉÛBÉÛÎÊ	^ÉØBÈ‰Ê	^ÙZÈ‰‚ÉèÈ«^¸¸¸ºBâ"“°Ğ¢&WGW&â²CÂ&÷rÂ–BÓ°Ğ§ĞĞ Ğ¦W‡÷'B7–æ2gVæ7F–öâWFFT÷&væ—¦F–öå66†VGVÆR†–çWC¢°Ğ¢–C¢Væ¶æ÷vã°Ğ¢Æ&VÃ¢Væ¶æ÷vã°Ğ¢66†VGVÆVDFFS¢Væ¶æ÷vã°Ğ¢7F'EF–ÖSó¢Væ¶æ÷vã°Ğ¢VæEF–ÖSó¢Væ¶æ÷vã°Ğ¢6FVv÷'“ó¢Væ¶æ÷vã°Ğ¢76–væVTÖVÖ&W$–Có¢Væ¶æ÷vã°Ğ¢76–væVTæÖSó¢Væ¶æ÷vã°Ğ¢FWF–Ç3ó¢Væ¶æ÷vã°Ğ¢6ö×ÆWFVCó¢Væ¶æ÷vã°Ğ¢ÖVÖ&W#¢66†VGVÆT7F÷#°Ğ§Ò’°Ğ¢6öç7B²CÂ&÷rÂ–BÒÒv—B&WV—&TVF—F&ÆU66†VGVÆR†–çWBæ–BÂ–çWBæÖVÖ&W"“°Ğ¢6öç7BÆ&VÂÒæ÷&ÖÆ—¦U66†VGVÆTÆ&VÂ†–çWBæÆ&VÂ“°Ğ¢6öç7B66†VGVÆVDFFRÒfÆ–DFFR†–çWBç66†VGVÆVDFFR“°Ğ¢–b‚Æ&VÂÇÂ66†VGVÆVDFFR’F‡&÷ræWrW'&÷"‚.ÉÛÎÊ	RÊ	Îºª«;Â¸*ÊyÎº[ÂÙ™^ÉÛÙ[BÊ;ÎÈKÉ©Bâ"“°Ğ¢6öç7B&WVW7FVD6FVv÷'’Ò6ÆVâ†–çWBæ6FVv÷'’“°Ğ¢6öç7B6FVv÷'’Ò&WVW7FVD6FVv÷'’ÓÓÒ&6öç7G'V7F–öâ Ğ¢ò&6öç7G'V7F–öâ Ğ¢¢æ÷&ÖÆ—¦U66†VGVÆT6FVv÷'’‡&WVW7FVD6FVv÷'’“°Ğ¢6öç7B&u7F'EF–ÖRÒ6ÆVâ†–çWBç7F'EF–ÖR“°Ğ¢6öç7B&tVæEF–ÖRÒ6ÆVâ†–çWBæVæEF–ÖR“°Ğ¢6öç7B7F'EF–ÖRÒfÆ–EF–ÖR‡&u7F'EF–ÖR“°Ğ¢6öç7BVæEF–ÖRÒfÆ–EF–ÖR‡&tVæEF–ÖR“°Ğ¢–b‚‡&u7F'EF–ÖRbb7F'EF–ÖR’ÇÂ‡&tVæEF–ÖRbbVæEF–ÖR’’°Ğ¢F‡&÷ræWrW'&÷"‚.È¹Î«NÉØ»hB¸ºÉÈNºÂÉè^º
^Ù[BÊ;ÎÈKÉ©Bâ"“°Ğ¢ĞĞ¢–b†VæEF–ÖRbb7F'EF–ÖR’F‡&÷ræWrW'&÷"‚.Ê(^º8ÂÈ¹Î«N»;N¸ºBÈ¹ÎÉéÈ¹Î«NÉØBº‹ÎÊÉè^º
^Ù[BÊ;ÎÈKÉ©Bâ"“°Ğ¢–b‡7F'EF–ÖRbbVæEF–ÖRbbVæEF–ÖRÂ7F'EF–ÖR’F‡&÷ræWrW'&÷"‚.Ê(^º8ÂÈ¹Î«NÉØÈ¹ÎÉéÈ¹Î«BÉÛNÙ¸NÉzÎÉ[ÂÙZ¸¸¸ºBâ"“°Ğ¢6öç7BFWF–Ç2Ò6ÆVâ†–çWBæFWF–Ç2’ç6Æ–6RƒÂS“°Ğ¢6öç7B76–væVRÒv—B&W6öÇfU66†VGVÆT76–væVR†CÂ–çWBæ76–væVTÖVÖ&W$–BÂ–çWBæÖVÖ&W"æF—7Æ”æÖR“°Ğ¢–b†6FVv÷'’ÓÓÒ&6öç7G'V7F–öâ"’°Ğ¢–b‚—5fÆ–D6öç7G'V7F–öå7FvR†Æ&VÂ’’°Ğ¢F‡&÷ræWrW'&÷"‚.È¹Î«;R«;^Ê	^º¨^ÉØBCÉéÉÛN¸+NºÂÉè^º
^Ù[BÊ;ÎÈKÉ©Bâ"“°Ğ¢ĞĞ¢6öç7B÷&væ—¦F–öâÒ7G&–ær‡&÷ræ÷&væ—¦F–öâóò""“°Ğ¢6öç7B'W6–æW75&÷VæBÒÖF‚æÖ‚ƒÂçVÖ&W"‡&÷ræ'W6–æW75÷&÷VæB’ÇÂ“°Ğ¢–b‚÷&væ—¦F–öâÇÂ'W6–æW75&÷VæBÃÒ’F‡&÷ræWrW'&÷"‚.È¹Î«;RÉÛÎÊ	^ÉØÉ{«+¹	Â«‹«HÉÛBÙXNÉ©NÙZ¸¸¸ºBâ"“°Ğ¢6öç7B&ö¦V7BÒv—BCç&W&R€Ğ¢4TÄT5B–Be$ôÒ6öç7G'V7F–öå÷66†VGVÆU÷&ö¦V7G0Ğ¢t„U$R÷&væ—¦F–öâÒòäB'W6–æW75÷&÷VæBÒòäBE$”Ò„4ôÄU44R††–FFVåöBÂrr’’ÒrrÄ”Ô•BÀĞ¢’æ&–æB†÷&væ—¦F–öâÂ'W6–æW75&÷VæB’æf—'7CÇ²–C¢çVÖ&W"Óâ‚“°Ğ¢–b‚&ö¦V7B’F‡&÷ræWrW'&÷"‚.È¹Î«;\+~¸*Ù(‚ÉÛÎÊ	^ÙÎÉyÙ[N¸»’«‹«HÉØBº‹ÎÊËiN«Ù[BÊ;ÎÈKÉ©Bâ"“°Ğ¢ĞĞ¢6öç7BGWÆ–6FRÒv—BCç&W&R€Ğ¢4TÄT5B–Be$ôÒ÷&væ—¦F–öå÷66†VGVÆW0Ğ¢t„U$R–BÃâğĞ¢äBÄõtU"…E$”Ò†÷&væ—¦F–öâ’’ÒÄõtU"…E$”Òƒò’Ğ¢äB'W6–æW75÷&÷VæBÒğĞ¢äBG·6VÖçF–566†VGVÆTÆ&VÅ7Â‚&÷&væ—¦F–öâ"Â&Æ&VÂ"—ÒÒğĞ¢äB66†VGVÆVEöFFRÒğĞ¢äBÄõtU"…E$”Ò„4ôÄU44R†6FVv÷'’ÂvvVæW&Âr’’’ÒÄõtU"…E$”Òƒò’Ğ¢äBE$”Ò„4ôÄU44R†FVÆWFVEöBÂrr’’ÒrpĞ¢Ä”Ô•BÀĞ¢’æ&–æB€Ğ¢–BÀĞ¢7G&–ær‡&÷ræ÷&væ—¦F–öâóò""’ÀĞ¢ÖF‚æÖ‚ƒÂçVÖ&W"‡&÷ræ'W6–æW75÷&÷VæB’ÇÂ’ÀĞ¢æ÷&ÖÆ—¦U66†VGVÆU6VÖçF–4Æ&VÂ…7G&–ær‡&÷ræ÷&væ—¦F–öâóò""’ÂÆ&VÂ’ÀĞ¢66†VGVÆVDFFRÀĞ¢6FVv÷'’ÀĞ¢’æf—'7CÇ²–C¢çVÖ&W"Óâ‚“°Ğ¢–b†GWÆ–6FR’F‡&÷ræWrW'&÷"‚.«	ÉØ«‹«H+~¸*ÊyÌ+~Ê	ÎºªÉÙ‚ÉÛÎÊ	^ÉÛBÉÛNºû‚¹;ºŞ¹	ÉkBÉèÈ«^¸¸¸ºBâ"“°Ğ¢v—BCç&W&R€Ğ¢UDDR÷&væ—¦F–öå÷66†VGVÆW0Ğ¢4UBÆ&VÂÒòÂ66†VGVÆVEöFFRÒòÂ7F'E÷F–ÖRÒòÂVæE÷F–ÖRÒòÂVæEöFFRÒòÂ6FVv÷'’ÒòÂ7FvRÒòÂFWF–Ç2ÒòÂ6ö×ÆWFVBÒòÀĞ¢76–væVUöÖVÖ&W%ö–BÒòÂ76–væVUöæÖRÒòÀĞ¢7–æ5÷7FGW2Ò44PĞ¢t„TâòÒwW'6öæÂräBE$”Ò„4ôÄU44R†vöövÆUöWfVçEö–BÂrr’’ÃârrD„TâwVæF–ærpĞ¢t„TâòÒwW'6öæÂrD„TâvÆö6ÅööæÇ’pĞ¢TÅ4RwVæF–ærpĞ¢TäBÀĞ¢7–æ5ö÷W&F–öâÒ44PĞ¢t„TâòÒwW'6öæÂräBE$”Ò„4ôÄU44R†vöövÆUöWfVçEö–BÂrr’’ÃârrD„TâwVæÆ–æ²pĞ¢t„TâòÒv6öç7G'V7F–öâräBE$”Ò„4ôÄU44R†vöövÆUöWfVçEö–BÂrr’’ÃârrD„TâvÖ÷fRÖ6öç7G'V7F–öâpĞ¢TÅ4RwW6W'BpĞ¢TäBÀĞ¢7–æ5öW'&÷"ÒrrÀĞ¢WFFVEö'’ÒòÂWFFVEö'•öæÖRÒòÂWFFVEöBÒ5U%$TåEõD”ÔU5DÕ Ğ¢t„U$R–BÒöÀĞ¢’æ&–æB€Ğ¢Æ&VÂÀĞ¢66†VGVÆVDFFRÀĞ¢7F'EF–ÖRÀĞ¢VæEF–ÖRÀĞ¢66†VGVÆVDFFRÀĞ¢6FVv÷'’ÀĞ¢6FVv÷'’ÓÓÒ&6öç7G'V7F–öâ"òÆ&VÂ¢""ÀĞ¢FWF–Ç2ÀĞ¢–çWBæ6ö×ÆWFVBÓÓÒG'VRò¢ÀĞ¢76–væVRæÖVÖ&W$–BÀĞ¢76–væVRææÖRÀĞ¢6FVv÷'’ÀĞ¢6FVv÷'’ÀĞ¢6FVv÷'’ÀĞ¢6FVv÷'’ÀĞ¢–çWBæÖVÖ&W"æ–BÀĞ¢–çWBæÖVÖ&W"æF—7Æ”æÖRÀĞ¢–BÀĞ¢’ç'Vâ‚“°Ğ¢6öç7B÷&væ—¦F–öâÒ7G&–ær‡&÷ræ÷&væ—¦F–öâóò""“°Ğ¢6öç7B'W6–æW75&÷VæBÒÖF‚æÖ‚ƒÂçVÖ&W"‡&÷ræ'W6–æW75÷&÷VæB’ÇÂ“°Ğ¢–b†'W6–æW75&÷VæBâ’°Ğ¢v—BÖ—'&÷$÷Vå66†VGVÆW5FôÆFW7D7F—f—G’€Ğ¢CÀĞ¢÷&væ—¦F–öâÀĞ¢'W6–æW75&÷VæBÀĞ¢v—BÆ—7E7F÷&VD÷&væ—¦F–öå66†VGVÆW2†÷&væ—¦F–öâÂ'W6–æW75&÷VæB’ÀĞ¢“°Ğ¢ĞĞ¢&WGW&â66†VGVÆT§6öâ‡²ââç&÷rÂ–BÂÆ&VÂÂ66†VGVÆVEöFFS¢66†VGVÆVDFFRÂ7F'E÷F–ÖS¢7F'EF–ÖRÀĞ¢VæE÷F–ÖS¢VæEF–ÖRÂVæEöFFS¢66†VGVÆVDFFRÀĞ¢6FVv÷'’Â7FvS¢6FVv÷'’ÓÓÒ&6öç7G'V7F–öâ"òÆ&VÂ¢""ÂFWF–Ç2Â6ö×ÆWFVC¢–çWBæ6ö×ÆWFVBÓÓÒG'VRò¢ÀĞ¢76–væVUöÖVÖ&W%ö–C¢76–væVRæÖVÖ&W$–BÀĞ¢76–væVUöæÖS¢76–væVRææÖRÂWFFVEö'•öæÖS¢–çWBæÖVÖ&W"æF—7Æ”æÖRÒ“°Ğ§ĞĞ Ğ¦W‡÷'B7–æ2gVæ7F–öâFVÆWFT÷&væ—¦F–öå66†VGVÆR†–çWC¢²–C¢Væ¶æ÷vã²ÖVÖ&W#¢66†VGVÆT7F÷"Ò’°Ğ¢6öç7B²CÂ&÷rÂ–BÒÒv—B&WV—&TVF—F&ÆU66†VGVÆR†–çWBæ–BÂ–çWBæÖVÖ&W"“°Ğ¢–b†6ÆVâ‡&÷rævöövÆUöWfVçEö–B’’°Ğ¢v—BCç&W&R€Ğ¢UDDR÷&væ—¦F–öå÷66†VGVÆW0Ğ¢4UBFVÆWFVEöBÒ5U%$TåEõD”ÔU5DÕÂ7–æ5÷7FGW2ÒwVæF–ærrÂ7–æ5ö÷W&F–öâÒvFVÆWFRrÀĞ¢7–æ5öW'&÷"ÒrrÂWFFVEö'’ÒòÂWFFVEö'•öæÖRÒòÂWFFVEöBÒ5U%$TåEõD”ÔU5DÕ Ğ¢t„U$R–BÒöÀĞ¢’æ&–æB†–çWBæÖVÖ&W"æ–BÂ–çWBæÖVÖ&W"æF—7Æ”æÖRÂ–B’ç'Vâ‚“°Ğ¢ÒVÇ6R°Ğ¢v—BCç&W&R†DTÄUDRe$ôÒ÷&væ—¦F–öå÷66†VGVÆW2t„U$R–BÒö’æ&–æB†–B’ç'Vâ‚“°Ğ¢ĞĞ¢6öç7B÷&væ—¦F–öâÒ7G&–ær‡&÷ræ÷&væ—¦F–öâóò""“°Ğ¢6öç7B'W6–æW75&÷VæBÒÖF‚æÖ‚ƒÂçVÖ&W"‡&÷ræ'W6–æW75÷&÷VæB’ÇÂ“°Ğ¢–b†'W6–æW75&÷VæBâ’°Ğ¢v—BÖ—'&÷$÷Vå66†VGVÆW5FôÆFW7D7F—f—G’€Ğ¢CÀĞ¢÷&væ—¦F–öâÀĞ¢'W6–æW75&÷VæBÀĞ¢v—BÆ—7E7F÷&VD÷&væ—¦F–öå66†VGVÆW2†÷&væ—¦F–öâÂ'W6–æW75&÷VæB’ÀĞ¢“°Ğ¢ĞĞ¢&WGW&â²–BÓ°Ğ§ĞĞ Ğ¦W‡÷'B7–æ2gVæ7F–öâÖW&vT7F—f—G•&öw&W7566†VGVÆR†–çWC¢°Ğ¢7F—f—G”–C¢çVÖ&W#°Ğ¢÷&væ—¦F–öã¢Væ¶æ÷vã°Ğ¢'W6–æW75&÷VæC¢Væ¶æ÷vã°Ğ¢&öw&W7566†VGVÆS¢Væ¶æ÷vã°Ğ¢ÖVÖ&W$–C¢çVÖ&W#°Ğ¢ÖVÖ&W$æÖS¢7G&–æs°Ğ§Ò’°Ğ¢6öç7B÷&væ—¦F–öâÒ6ÆVâ†–çWBæ÷&væ—¦F–öâ’ç6Æ–6RƒÂ#“°Ğ¢6öç7B'W6–æW75&÷VæBÒÖF‚æÖ‚ƒÂçVÖ&W"†–çWBæ'W6–æW75&÷VæB’ÇÂ“°Ğ¢6öç7B–æ6öÖ–ærÒ'6U&öw&W7566†VGVÆTVçG&–W2†6ÆVâ†–çWBç&öw&W7566†VGVÆR’“°Ğ¢–b‚÷&væ—¦F–öâÇÂ–æ6öÖ–æræÆVæwF‚’&WGW&ã°Ğ¢6öç7BCÒv—BVç7W&T÷&væ—¦F–öå66†VGVÆW5&VG’‚“°Ğ¢v—BCç&W&R€Ğ¢”å4U%Bõ"”täõ$R”åDò÷&væ—¦F–öå÷66†VGVÆUö–×÷'E÷7FFR€Ğ¢÷&væ—¦F–öâÂ'W6–æW75÷&÷Væ@Ğ¢’dÅTU2ƒòÂò–ÀĞ¢’æ&–æB†÷&væ—¦F–öâÂ'W6–æW75&÷VæB’ç'Vâ‚“°Ğ¢6öç7Bv†—§§W66÷RÒv—B—5v†—§§Wv&E66÷R†CÂ÷&væ—¦F–öâÂ'W6–æW75&÷VæB“°Ğ¢6öç7B6öç7G'V7F–öä–æ6öÖ–ærÒv†—§§W66÷PĞ¢ò–æ6öÖ–æræf–ÇFW"‚‡66†VGVÆR’ÓàĞ¢—4ÆÆ÷vVD”WFõ66†VGVÆR‡66†VGVÆRæÆ&VÂÂ°Ğ¢ÆÆ÷t6öç7G'V7F–öã¢G'VRÀĞ¢—46öç7G'V7F–öã¢—46öç7G'V7F–öå7FvR‡66†VGVÆRæÆ&VÂ’ÀĞ¢ÒĞ¢bb—46öç7G'V7F–öå7FvR‡66†VGVÆRæÆ&VÂ’Ğ¢¢µÓ°Ğ¢òò««‹ºŞÉyÊÙèÂºª¹:¸*ÊyÎº[ÂÉÛÎ»	‚şÉˆÉxRÉÛÎÊ	^ÉËÎºÂºxÎ¹:N¸Ù‚«+ŞºÎº[ÂºxÈ«^¸¸¸ºBàĞ¢òòÉé¸ù’ÉÛÎÊ	^ÉØÉÈNÊhÉx\+~ÉyÉkNØÊÈªNÉÙ‚Ù™^Ê	^¹	ÂÈ{Îº;‚È¹ÎÉ{ºxÂ»8N¸øNºÂÙxÉªÙZ¸¸¸ºBàĞ¢6öç7B6†÷w&ööÔ–æ6öÖ–ærÒ–æ6öÖ–æræf–ÇFW"‚‡66†VGVÆR’ÓàĞ¢—4&÷fVE6†÷w&ööÔWFõ66†VGVÆR‡66†VGVÆRæÆ&VÂ’“°Ğ Ğ¢–b‡6†÷w&ööÔ–æ6öÖ–æræÆVæwF‚’°Ğ¢v—BCæ&F6‚‡6†÷w&ööÔ–æ6öÖ–æræÖ‚‡66†VGVÆR’ÓâCç&W&R€Ğ¢”å4U%B”åDò÷&væ—¦F–öå÷66†VGVÆW2€Ğ¢÷&væ—¦F–öâÂ'W6–æW75÷&÷VæBÂÆ&VÂÂ66†VGVÆVEöFFRÂ7F'E÷F–ÖRÂVæE÷F–ÖRÀĞ¢6FVv÷'’ÂVæEöFFRÂ6ö×ÆWFVBÂ6÷W&6Uö7F—f—G•ö–BÀĞ¢7&VFVEö'’Â7&VFVEö'•öæÖRÂWFFVEö'’ÂWFFVEö'•öæÖPĞ¢Ğ¢4TÄT5BòÂòÂòÂòÂòÂòÂw6†÷w&ööÒrÂòÂÂòÂòÂòÂòÂğĞ¢t„U$RäõBU„•5E2€Ğ¢4TÄT5Be$ôÒ÷&væ—¦F–öå÷66†VGVÆW0Ğ¢t„U$R÷&væ—¦F–öâÒòäB'W6–æW75÷&÷VæBÒòäB6FVv÷'’Òw6†÷w&ööÒpĞ¢äB66†VGVÆVEöFFRÒòäB4ôÄU44R‡7F'E÷F–ÖRÂrr’ÒğĞ¢äB4ôÄU44R†VæE÷F–ÖRÂrr’ÒğĞ¢äBÄõtU"…E$”Ò†Æ&VÂ’’ÒÄõtU"…E$”Òƒò’Ğ¢äBE$”Ò„4ôÄU44R†FVÆWFVEöBÂrr’’ÒrpĞ¢–ÀĞ¢’æ&–æB€Ğ¢÷&væ—¦F–öâÂ'W6–æW75&÷VæBÂ66†VGVÆRæÆ&VÂÂ66†VGVÆRæFFRÀĞ¢66†VGVÆRç7F'EF–ÖRÂ66†VGVÆRæVæEF–ÖRÂ66†VGVÆRæFFRÂ–çWBæ7F—f—G”–BÀĞ¢–çWBæÖVÖ&W$–BÂ–çWBæÖVÖ&W$æÖRÂ–çWBæÖVÖ&W$–BÂ–çWBæÖVÖ&W$æÖRÀĞ¢÷&væ—¦F–öâÂ'W6–æW75&÷VæBÂ66†VGVÆRæFFRÂ66†VGVÆRç7F'EF–ÖRÀĞ¢66†VGVÆRæVæEF–ÖRÂ66†VGVÆRæÆ&VÂÀĞ¢’’“°Ğ¢ĞĞ Ğ¢–b†6öç7G'V7F–öä–æ6öÖ–æræÆVæwF‚’°Ğ¢v—BCç&W&R€Ğ¢”å4U%B”åDò6öç7G'V7F–öå÷66†VGVÆU÷&ö¦V7G2€Ğ¢÷&væ—¦F–öâÂ'W6–æW75÷&÷VæBÂv÷&µ÷7VÖÖ'’Âv÷&µ÷7VÖÖ'•öÖöFRÂ6ö×ÆWFVBÀĞ¢7&VFVEö'’Â7&VFVEö'•öæÖRÂWFFVEö'’ÂWFFVEö'•öæÖPĞ¢’dÅTU2ƒòÂòÂrrÂvWFòrÂÂòÂòÂòÂòĞ¢ôâ4ôädÄ”5B†÷&væ—¦F–öâÂ'W6–æW75÷&÷VæB’DòUDDR4U@Ğ¢†–FFVåöBÒrrÂ6ö×ÆWFVBÒÀĞ¢WFFVEö'’ÒW†6ÇVFVBçWFFVEö'’ÀĞ¢WFFVEö'•öæÖRÒW†6ÇVFVBçWFFVEö'•öæÖRÀĞ¢WFFVEöBÒ5U%$TåEõD”ÔU5DÕÀĞ¢’æ&–æB€Ğ¢÷&væ—¦F–öâÀĞ¢'W6–æW75&÷VæBÀĞ¢–çWBæÖVÖ&W$–BÀĞ¢–çWBæÖVÖ&W$æÖRÀĞ¢–çWBæÖVÖ&W$–BÀĞ¢–çWBæÖVÖ&W$æÖRÀĞ¢’ç'Vâ‚“°Ğ Ğ¢v—BCæ&F6‚†6öç7G'V7F–öä–æ6öÖ–æræÖ‚‡66†VGVÆR’ÓâCç&W&R€Ğ¢”å4U%B”åDò÷&væ—¦F–öå÷66†VGVÆW2€Ğ¢÷&væ—¦F–öâÂ'W6–æW75÷&÷VæBÂÆ&VÂÂ66†VGVÆVEöFFRÂ7F'E÷F–ÖRÂVæE÷F–ÖRÂ6FVv÷'’Â7FvRÀĞ¢VæEöFFRÂ6ö×ÆWFVBÂ6÷W&6Uö7F—f—G•ö–BÀĞ¢7&VFVEö'’Â7&VFVEö'•öæÖRÂWFFVEö'’ÂWFFVEö'•öæÖPĞ¢Ğ¢4TÄT5BòÂòÂòÂòÂòÂòÂv6öç7G'V7F–öârÂòÂòÂÂòÂòÂòÂòÂğĞ¢t„U$RäõBU„•5E2€Ğ¢4TÄT5Be$ôÒ÷&væ—¦F–öå÷66†VGVÆW0Ğ¢t„U$R÷&væ—¦F–öâÒòäB'W6–æW75÷&÷VæBÒòäB6FVv÷'’Òv6öç7G'V7F–öâpĞ¢äB7FvRÒòäB66†VGVÆVEöFFRÒğĞ¢äB4ôÄU44R„åTÄÄ”b†VæEöFFRÂrr’Â66†VGVÆVEöFFR’ÒğĞ¢äB4ôÄU44R‡7F'E÷F–ÖRÂrr’ÒòäB4ôÄU44R†VæE÷F–ÖRÂrr’ÒğĞ¢–ÀĞ¢’æ&–æB€Ğ¢÷&væ—¦F–öâÀĞ¢'W6–æW75&÷VæBÀĞ¢66†VGVÆRæÆ&VÂÀĞ¢66†VGVÆRæFFRÀĞ¢66†VGVÆRç7F'EF–ÖRÀĞ¢66†VGVÆRæVæEF–ÖRÀĞ¢66†VGVÆRæÆ&VÂÀĞ¢66†VGVÆRæFFRÀĞ¢–çWBæ7F—f—G”–BÀĞ¢–çWBæÖVÖ&W$–BÀĞ¢–çWBæÖVÖ&W$æÖRÀĞ¢–çWBæÖVÖ&W$–BÀĞ¢–çWBæÖVÖ&W$æÖRÀĞ¢÷&væ—¦F–öâÀĞ¢'W6–æW75&÷VæBÀĞ¢66†VGVÆRæÆ&VÂÀĞ¢66†VGVÆRæFFRÀĞ¢66†VGVÆRæFFRÀĞ¢66†VGVÆRç7F'EF–ÖRÀĞ¢66†VGVÆRæVæEF–ÖRÀĞ¢’’“°Ğ Ğ¢6öç7BGWÆ–6FTvVæW&Åv†W&RÒ Ğ¢÷&væ—¦F–öâÒòäB'W6–æW75÷&÷VæBÒğĞ¢äB4ôÄU44R†6FVv÷'’ÂvvVæW&Âr’Ãâv6öç7G'V7F–öâpĞ¢äB6÷W&6Uö7F—f—G•ö–BÒğĞ¢äBU„•5E2€Ğ¢4TÄT5Be$ôÒ÷&væ—¦F–öå÷66†VGVÆW26öç7G'V7F–öàĞ¢t„U$R6öç7G'V7F–öâæ÷&væ—¦F–öâÒ÷&væ—¦F–öå÷66†VGVÆW2æ÷&væ—¦F–öàĞ¢äB6öç7G'V7F–öâæ'W6–æW75÷&÷VæBÒ÷&væ—¦F–öå÷66†VGVÆW2æ'W6–æW75÷&÷Væ@Ğ¢äB6öç7G'V7F–öâæ6FVv÷'’Òv6öç7G'V7F–öâpĞ¢äB6öç7G'V7F–öâç6÷W&6Uö7F—f—G•ö–BÒğĞ¢äB6öç7G'V7F–öâç7FvRÒ÷&væ—¦F–öå÷66†VGVÆW2æÆ&VÀĞ¢äB6öç7G'V7F–öâç66†VGVÆVEöFFRÒ÷&væ—¦F–öå÷66†VGVÆW2ç66†VGVÆVEöFFPĞ¢äB4ôÄU44R†6öç7G'V7F–öâç7F'E÷F–ÖRÂrr’Ò4ôÄU44R†÷&væ—¦F–öå÷66†VGVÆW2ç7F'E÷F–ÖRÂrrĞ¢äB4ôÄU44R†6öç7G'V7F–öâæVæE÷F–ÖRÂrr’Ò4ôÄU44R†÷&væ—¦F–öå÷66†VGVÆW2æVæE÷F–ÖRÂrrĞ¢äBE$”Ò„4ôÄU44R†6öç7G'V7F–öâæFVÆWFVEöBÂrr’’ÒrpĞ¢–°Ğ¢v—BCæ&F6‚…°Ğ¢Cç&W&R€Ğ¢UDDR÷&væ—¦F–öå÷66†VGVÆW0Ğ¢4UBFVÆWFVEöBÒ5U%$TåEõD”ÔU5DÕÂ7–æ5÷7FGW2ÒwVæF–ærrÂ7–æ5ö÷W&F–öâÒvFVÆWFRrÀĞ¢7–æ5öW'&÷"ÒrrÂWFFVEö'’ÒòÂWFFVEö'•öæÖRÒòÂWFFVEöBÒ5U%$TåEõD”ÔU5DÕ Ğ¢t„U$RG¶GWÆ–6FTvVæW&Åv†W&WÒäBE$”Ò„4ôÄU44R†vöövÆUöWfVçEö–BÂrr’’ÃârvÀĞ¢’æ&–æB€Ğ¢–çWBæÖVÖ&W$–BÀĞ¢–çWBæÖVÖ&W$æÖRÀĞ¢÷&væ—¦F–öâÀĞ¢'W6–æW75&÷VæBÀĞ¢–çWBæ7F—f—G”–BÀĞ¢–çWBæ7F—f—G”–BÀĞ¢’ÀĞ¢Cç&W&R€Ğ¢DTÄUDRe$ôÒ÷&væ—¦F–öå÷66†VGVÆW0Ğ¢t„U$RG¶GWÆ–6FTvVæW&Åv†W&WÒäBE$”Ò„4ôÄU44R†vöövÆUöWfVçEö–BÂrr’’ÒrvÀĞ¢’æ&–æB€Ğ¢÷&væ—¦F–öâÀĞ¢'W6–æW75&÷VæBÀĞ¢–çWBæ7F—f—G”–BÀĞ¢–çWBæ7F—f—G”–BÀĞ¢’ÀĞ¢Ò“°Ğ Ğ¢v—BCç&W&R€Ğ¢UDDR7F—f—F–W0Ğ¢4UBv&E÷7FvRÒ44PĞ¢t„Tâv&E÷7FvRÒ~¸*Ù(‚É˜Nº8ÂrD„Tâv&E÷7FvPĞ¢TÅ4R~ÈJNË™Œ+~«;^È*ÂÊxNÙh’pĞ¢TäBÂWFFVEöBÒ5U%$TåEõD”ÔU5DÕ Ğ¢t„U$R–BÒ€Ğ¢4TÄT5B–Be$ôÒ7F—f—F–W0Ğ¢t„U$R÷&væ—¦F–öâÒòäB'W6–æW75÷&÷VæBÒòäBv&E÷7FGW2Ò~ÉÈNÊhÉxRÈ‰Ê;ÂpĞ¢õ$DU"%’7F—f—G•öFFRDU42Â–BDU42Ä”Ô•BĞ¢’äB4ôÄU44R†v&E÷7FvUöÖçVÂÂ’ÒÀĞ¢’æ&–æB†÷&væ—¦F–öâÂ'W6–æW75&÷VæB’ç'Vâ‚“°Ğ Ğ¢6öç7B÷Vå66†VGVÆW2Òv—BCç&W&R€Ğ¢4TÄT5B¢e$ôÒ÷&væ—¦F–öå÷66†VGVÆW0Ğ¢t„U$R÷&væ—¦F–öâÒòäB'W6–æW75÷&÷VæBÒğĞ¢äBE$”Ò„4ôÄU44R†FVÆWFVEöBÂrr’’ÒrpĞ¢õ$DU"%’66†VGVÆVEöFFR42Â–B46ÀĞ¢’æ&–æB†÷&væ—¦F–öâÂ'W6–æW75&÷VæB’æÆÃÅ&V6÷&CÇ7G&–ærÂVæ¶æ÷vããâ‚“°Ğ¢v—BÖ—'&÷$÷Vå66†VGVÆW5FôÆFW7D7F—f—G’€Ğ¢CÀĞ¢÷&væ—¦F–öâÀĞ¢'W6–æW75&÷VæBÀĞ¢÷Vå66†VGVÆW2ç&W7VÇG2æÖ‡66†VGVÆT§6öâ’ÀĞ¢“°Ğ¢ĞĞ§ĞĞ 
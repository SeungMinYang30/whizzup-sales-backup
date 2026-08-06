import { getD1 } from "../db";
import { ensureCollaborationReady } from "./collaboration";

const createCampaignsSql = `
  CREATE TABLE IF NOT EXISTS sales_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    budget_type TEXT NOT NULL DEFAULT '',
    budget_group_id INTEGER,
    budget_match_status TEXT NOT NULL DEFAULT 'unclassified',
    budget_match_method TEXT NOT NULL DEFAULT 'legacy',
    budget_request_id TEXT,
    budget_kind TEXT NOT NULL DEFAULT 'unclassified',
    budget_amount_mode TEXT NOT NULL DEFAULT 'manual',
    selection_date TEXT NOT NULL DEFAULT '',
    default_budget_amount INTEGER,
    source_file_name TEXT NOT NULL DEFAULT '',
    import_source TEXT NOT NULL DEFAULT '',
    import_status TEXT NOT NULL DEFAULT 'complete',
    expected_target_count INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

const createTargetsSql = `
  CREATE TABLE IF NOT EXISTS sales_campaign_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    organization TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    assigned_member_id INTEGER,
    activity_id INTEGER,
    budget_amount INTEGER,
    school_level TEXT NOT NULL DEFAULT '',
    supply_items TEXT NOT NULL DEFAULT '',
    review_note TEXT NOT NULL DEFAULT '',
    business_round INTEGER NOT NULL DEFAULT 1,
    created_activity INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

let campaignsReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function initializeCampaigns() {
  const d1 = getD1();
  await ensureCollaborationReady();
  await d1.batch([
    d1.prepare(createCampaignsSql),
    d1.prepare(createTargetsSql),
  ]);
  const campaignColumns = await d1
    .prepare("PRAGMA table_info(sales_campaigns)")
    .all<{ name: string }>();
  const existingCampaignColumns = new Set(
    campaignColumns.results.map((column) => column.name),
  );
  if (!existingCampaignColumns.has("import_status")) {
    await d1
      .prepare(
        "ALTER TABLE sales_campaigns ADD COLUMN import_status TEXT NOT NULL DEFAULT 'complete'",
      )
      .run();
  }
  if (!existingCampaignColumns.has("expected_target_count")) {
    await d1
      .prepare(
        "ALTER TABLE sales_campaigns ADD COLUMN expected_target_count INTEGER NOT NULL DEFAULT 0",
      )
      .run();
  }
  const targetColumns = await d1
    .prepare("PRAGMA table_info(sales_campaign_targets)")
    .all<{ name: string }>();
  if (!targetColumns.results.some((column) => column.name === "business_round")) {
    await d1
      .prepare(
        "ALTER TABLE sales_campaign_targets ADD COLUMN business_round INTEGER NOT NULL DEFAULT 1",
      )
      .run();
  }
  await d1.batch([
    d1.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS sales_campaigns_name_idx ON sales_campaigns (name)",
    ),
    d1.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS sales_campaign_targets_campaign_org_idx ON sales_campaign_targets (campaign_id, organization)",
    ),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS sales_campaign_targets_assignee_idx ON sales_campaign_targets (assigned_member_id, campaign_id)",
    ),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS sales_campaign_targets_org_round_campaign_idx ON sales_campaign_targets (organization, business_round, campaign_id)",
    ),
  ]);
  return d1;
}

export function ensureCampaignsReady() {
  if (!campaignsReadyPromise) {
    campaignsReadyPromise = initializeCampaigns().catch((error) => {
      campaignsReadyPromise = null;
      throw error;
    });
  }
  return campaignsReadyPromise;
}

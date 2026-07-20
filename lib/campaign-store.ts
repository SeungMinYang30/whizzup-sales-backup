import { getD1 } from "../db";
import { ensureCollaborationReady } from "./collaboration";

const createCampaignsSql = `
  CREATE TABLE IF NOT EXISTS sales_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
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
    d1.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS sales_campaigns_name_idx ON sales_campaigns (name)",
    ),
    d1.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS sales_campaign_targets_campaign_org_idx ON sales_campaign_targets (campaign_id, organization)",
    ),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS sales_campaign_targets_assignee_idx ON sales_campaign_targets (assigned_member_id, campaign_id)",
    ),
  ]);
  return d1;
}

export function ensureCampaignsReady() {
  return Promise.resolve(getD1());
}

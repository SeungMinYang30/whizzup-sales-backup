import { getD1 } from "../db";
import { ensureCollaborationReady } from "./collaboration";

export async function ensureCampaignsReady() {
  await ensureCollaborationReady();
  return getD1();
}

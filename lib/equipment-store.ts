import { getD1 } from "../db";
import { ensureCollaborationReady } from "./collaboration";

export async function ensureEquipmentReady() {
  await ensureCollaborationReady();
  return getD1();
}

import {
  accessErrorResponse,
  requirePrimaryOwner,
} from "../../../lib/collaboration";
import {
  ensureDataControlReady,
  listActiveDataArchives,
  listDataControlEvents,
  listDataControlUnits,
} from "../../../lib/data-control-store";
import { purgeExpiredTrash } from "../../../lib/trash-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePrimaryOwner();
    const d1 = await ensureDataControlReady();
    await purgeExpiredTrash(d1);
    const [units, archives, events] = await Promise.all([
      listDataControlUnits(),
      listActiveDataArchives(),
      listDataControlEvents(),
    ]);
    return Response.json({ units, archives, events });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

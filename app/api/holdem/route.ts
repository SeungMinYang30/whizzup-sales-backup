import { accessErrorResponse, ensureCollaborationReady, requireApprovedMember } from "../../../lib/collaboration";

export const dynamic = "force-dynamic";

async function ready() {
  const d1 = await ensureCollaborationReady();
  await d1.prepare(`CREATE TABLE IF NOT EXISTS holdem_weekly_scores (
    member_id INTEGER NOT NULL,
    week_start TEXT NOT NULL,
    best_chips INTEGER NOT NULL DEFAULT 1000,
    games_played INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (member_id, week_start)
  )`).run();
  return d1;
}

const weekStart = () => {
  const now = new Date();
  const seoul = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const day = seoul.getDay() || 7;
  seoul.setDate(seoul.getDate() - day + 1);
  return `${seoul.getFullYear()}-${String(seoul.getMonth() + 1).padStart(2, "0")}-${String(seoul.getDate()).padStart(2, "0")}`;
};

export async function GET() {
  try {
    const member = await requireApprovedMember();
    const d1 = await ready();
    const week = weekStart();
    const rows = await d1.prepare(`SELECT h.member_id AS memberId, m.display_name AS displayName,
      h.best_chips AS bestChips, h.games_played AS gamesPlayed, h.wins
      FROM holdem_weekly_scores h JOIN members m ON m.id = h.member_id
      WHERE h.week_start = ? AND m.status = 'approved'
      ORDER BY h.best_chips DESC, h.wins DESC, h.updated_at ASC LIMIT 10`).bind(week).all();
    return Response.json({ weekStart: week, memberId: member.id, leaderboard: rows.results });
  } catch (error) { return accessErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const body = await request.json() as { chips?: unknown; won?: unknown };
    const chips = Math.max(0, Math.min(10000, Math.round(Number(body.chips) || 0)));
    const won = body.won === true ? 1 : 0;
    const d1 = await ready();
    await d1.prepare(`INSERT INTO holdem_weekly_scores (member_id, week_start, best_chips, games_played, wins, updated_at)
      VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(member_id, week_start) DO UPDATE SET
        best_chips = GREATEST(best_chips, excluded.best_chips), games_played = games_played + 1,
        wins = wins + excluded.wins, updated_at = CURRENT_TIMESTAMP`)
      .bind(member.id, weekStart(), chips, won).run();
    return GET();
  } catch (error) { return accessErrorResponse(error); }
}

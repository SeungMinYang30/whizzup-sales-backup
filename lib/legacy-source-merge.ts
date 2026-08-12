import { getD1 } from "../db";
import { createFullBackup, type BackupTableName, type FullBackup } from "./backup-store";

type Row = Record<string, unknown>;
type MemberActor = { id: number; displayName: string };

const LEGACY_SOURCE_ORIGIN = "https://whizzup-sales-hub.jackallan.chatgpt.site";
const SNAPSHOT_TABLES = [
  "members",
  "activities",
  "activity_authors",
  "activity_assignment_history",
  "organization_schedules",
  "sales_campaigns",
  "sales_campaign_targets",
  "complex_projects",
  "budget_name_groups",
  "budget_name_aliases",
  "budget_name_members",
  "budget_name_events",
] as const satisfies readonly BackupTableName[];

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function key(value: unknown) {
  return text(value).toLocaleLowerCase("ko-KR").replace(/[\s·ㆍ._-]+/g, "");
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function rows(backup: FullBackup, table: BackupTableName) {
  return (backup.data[table] ?? []) as Row[];
}

function legacyOrigin(currentOrigin?: string) {
  const configured = text(process.env.LEGACY_SITE_ORIGIN || process.env.PRIMARY_SITE_ORIGIN);
  if (configured && !configured.includes("whizzup.kr") && !configured.includes("vercel.app")) {
    return configured.replace(/\/+$/, "");
  }
  if (currentOrigin && currentOrigin.includes("jackallan.chatgpt.site")) {
    return currentOrigin.replace(/\/+$/, "");
  }
  return LEGACY_SOURCE_ORIGIN;
}

async function fetchLegacyBackup(currentOrigin?: string) {
  const secret = text(process.env.PRIMARY_EXPORT_SECRET || process.env.STANDBY_EXPORT_SECRET);
  if (!secret) throw new Error("원본 데이터 비교용 서버 인증값이 설정되지 않았습니다.");
  const origin = legacyOrigin(currentOrigin);
  const response = await fetch(`${origin}/api/standby-export`, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`원본 데이터 백업을 불러오지 못했습니다. (${response.status})`);
  }
  return { origin, backup: (await response.json()) as FullBackup };
}

function activityStableKey(row: Row) {
  const seedKey = key(row.seed_key);
  if (seedKey) return `seed:${seedKey}`;
  return [
    key(row.organization),
    integer(row.business_round, 1),
    text(row.activity_date).slice(0, 10),
    key(row.topic),
    key(row.raw_input || row.summary),
  ].join("|");
}

function projectStableKey(row: Row) {
  return [
    key(row.organization),
    integer(row.business_round, 1),
    key(row.name),
    key(row.budget_original_name || row.budget_type),
  ].join("|");
}

function scheduleStableKey(row: Row) {
  return [
    key(row.organization),
    integer(row.business_round, 1),
    text(row.scheduled_date).slice(0, 10),
    key(row.label),
    text(row.start_time),
  ].join("|");
}

function campaignTargetStableKey(row: Row, campaigns: Map<number, Row>) {
  return [
    key(campaigns.get(integer(row.campaign_id))?.name),
    key(row.organization),
    integer(row.business_round, 1),
  ].join("|");
}

function complexProjectStableKey(row: Row) {
  return [key(row.organization), integer(row.business_round, 1), key(row.name)].join("|");
}

function memberAliases(member: Row) {
  const displayName = text(member.display_name);
  const aliases = new Set([key(displayName)]);
  const base = displayName.replace(/\s*(대표님|대표|이사|본부장|부장|팀장|과장|대리|사원)$/u, "");
  if (base) aliases.add(key(base));
  if (text(member.email).toLowerCase() === "freeyang30@gmail.com") {
    aliases.add(key("양승민"));
    aliases.add(key("양승민 이사"));
  }
  return aliases;
}

function memberIndexes(backup: FullBackup, preferredMemberId = 0) {
  const byId = new Map<number, Row>();
  const byEmail = new Map<string, Row>();
  const byEmailAll = new Map<string, Row[]>();
  const emailByAlias = new Map<string, string>();
  for (const member of rows(backup, "members")) {
    const email = text(member.email).toLowerCase();
    byId.set(integer(member.id), member);
    if (email) {
      const duplicates = byEmailAll.get(email) ?? [];
      duplicates.push(member);
      byEmailAll.set(email, duplicates);
    }
    for (const alias of memberAliases(member)) {
      if (alias && email && !emailByAlias.has(alias)) emailByAlias.set(alias, email);
    }
  }
  for (const [email, duplicates] of byEmailAll) {
    const selected = [...duplicates].sort((left, right) => {
      const preferred = Number(integer(right.id) === preferredMemberId) - Number(integer(left.id) === preferredMemberId);
      const approved = Number(text(right.status) === "approved") - Number(text(left.status) === "approved");
      const sales = integer(right.is_sales) - integer(left.is_sales);
      return preferred || approved || sales || integer(right.id) - integer(left.id);
    })[0];
    if (selected) byEmail.set(email, selected);
  }
  return { byId, byEmail, byEmailAll, emailByAlias };
}

function assignmentCounts(backup: FullBackup) {
  const members = memberIndexes(backup);
  const result = new Map<string, Record<string, number>>();
  const increment = (email: string, field: string) => {
    if (!email) return;
    const counts = result.get(email) ?? {
      activities: 0,
      authoredActivities: 0,
      assignmentHistory: 0,
      schedules: 0,
      campaignTargets: 0,
      complexProjects: 0,
      total: 0,
    };
    counts[field] = (counts[field] ?? 0) + 1;
    counts.total += 1;
    result.set(email, counts);
  };
  for (const activity of rows(backup, "activities")) {
    increment(members.emailByAlias.get(key(activity.progress_manager)) ?? "", "activities");
  }
  for (const author of rows(backup, "activity_authors")) {
    increment(text(members.byId.get(integer(author.member_id))?.email).toLowerCase(), "authoredActivities");
  }
  for (const history of rows(backup, "activity_assignment_history")) {
    increment(text(members.byId.get(integer(history.to_member_id))?.email).toLowerCase(), "assignmentHistory");
  }
  for (const schedule of rows(backup, "organization_schedules")) {
    const email = text(members.byId.get(integer(schedule.assignee_member_id))?.email).toLowerCase()
      || members.emailByAlias.get(key(schedule.assignee_name))
      || "";
    increment(email, "schedules");
  }
  for (const target of rows(backup, "sales_campaign_targets")) {
    increment(text(members.byId.get(integer(target.assigned_member_id))?.email).toLowerCase(), "campaignTargets");
  }
  for (const project of rows(backup, "complex_projects")) {
    const email = text(members.byId.get(integer(project.manager_member_id))?.email).toLowerCase()
      || members.emailByAlias.get(key(project.manager_name))
      || "";
    increment(email, "complexProjects");
  }
  return result;
}

function unclassifiedNames(backup: FullBackup) {
  const names = new Set<string>();
  const excludedAwards = new Set(["\ud611\ub825\uc0ac \uc218\uc8fc", "\ud0c0\uc5c5\uccb4 \uc218\uc8fc"]);
  const allowedStatuses = new Set(["review", "unclassified", "legacy"]);
  const activitiesById = new Map(
    rows(backup, "activities").map((activity) => [integer(activity.id), activity] as const),
  );
  for (const row of rows(backup, "activities")) {
    if (integer(row.budget_group_id) > 0) continue;
    if (excludedAwards.has(text(row.award_status))) continue;
    if (!allowedStatuses.has(text(row.budget_match_status) || "unclassified")) continue;
    const name = text(row.budget_original_name || row.budget_type);
    if (name) names.add(key(name));
  }
  for (const row of rows(backup, "equipment_projects")) {
    if (integer(row.budget_group_id) > 0) continue;
    if (!allowedStatuses.has(text(row.budget_match_status) || "unclassified")) continue;
    const activity = activitiesById.get(integer(row.activity_id));
    if (activity && excludedAwards.has(text(activity.award_status))) continue;
    const name = text(row.budget_original_name || row.budget_type);
    if (name) names.add(key(name));
  }
  return names.size;
}

function budgetSummary(backup: FullBackup) {
  const aliases = rows(backup, "budget_name_aliases");
  const members = rows(backup, "budget_name_members");
  const events = rows(backup, "budget_name_events");
  return rows(backup, "budget_name_groups")
    .map((group) => ({
      id: integer(group.id),
      canonicalName: text(group.canonical_name),
      canonicalKey: text(group.canonical_key),
      budgetKind: text(group.budget_kind),
      amountMode: text(group.amount_mode),
      defaultAmount: group.default_amount === null ? null : integer(group.default_amount),
      active: integer(group.active) === 1,
      sortOrder: integer(group.sort_order),
      aliases: aliases
        .filter((alias) => integer(alias.group_id) === integer(group.id) && integer(alias.active, 1) === 1)
        .map((alias) => text(alias.alias_name)),
      linkCount: members.filter((member) => integer(member.group_id) === integer(group.id) && integer(member.active, 1) === 1).length,
      eventCount: events.filter((event) => integer(event.group_id) === integer(group.id)).length,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.canonicalName.localeCompare(right.canonicalName, "ko-KR"));
}

function memberSummary(backup: FullBackup) {
  const counts = assignmentCounts(backup);
  return rows(backup, "members")
    .filter((member) => text(member.status) === "approved")
    .map((member) => {
      const email = text(member.email).toLowerCase();
      return {
        id: integer(member.id),
        email,
        displayName: text(member.display_name),
        jobTitle: text(member.job_title),
        status: text(member.status),
        isSales: integer(member.is_sales) === 1,
        assignments: counts.get(email) ?? { total: 0 },
      };
    })
    .sort((left, right) => left.email.localeCompare(right.email));
}

export async function compareLegacySource(currentOrigin?: string) {
  const [{ origin, backup: source }, target] = await Promise.all([
    fetchLegacyBackup(currentOrigin),
    createFullBackup(),
  ]);
  const sourceGroups = budgetSummary(source);
  const targetGroups = budgetSummary(target);
  const targetGroupKeys = new Set(targetGroups.map((group) => key(group.canonicalKey || group.canonicalName)));
  const sourceMembers = memberSummary(source);
  const targetMembers = memberSummary(target);
  const targetEmails = new Set(targetMembers.map((member) => member.email));
  return {
    sourceOrigin: origin,
    comparedAt: new Date().toISOString(),
    budgets: {
      sourceCount: sourceGroups.length,
      targetCount: targetGroups.length,
      sourceUnclassifiedCount: unclassifiedNames(source),
      targetUnclassifiedCount: unclassifiedNames(target),
      missing: sourceGroups.filter((group) => !targetGroupKeys.has(key(group.canonicalKey || group.canonicalName))),
      source: sourceGroups,
      target: targetGroups,
    },
    members: {
      sourceApprovedCount: sourceMembers.length,
      targetApprovedCount: targetMembers.length,
      missingEmails: sourceMembers.filter((member) => !targetEmails.has(member.email)).map((member) => member.email),
      duplicateEmails: [...memberIndexes(target).byEmailAll.entries()]
        .filter(([, members]) => members.length > 1)
        .map(([email, members]) => ({ email, memberIds: members.map((member) => integer(member.id)) })),
      source: sourceMembers,
      target: targetMembers,
    },
  };
}

async function ensureSnapshotTable() {
  await getD1().prepare(`
    CREATE TABLE IF NOT EXISTS legacy_source_merge_backups (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      source_origin TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_by BIGINT NOT NULL,
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

function snapshotData(backup: FullBackup) {
  return Object.fromEntries(SNAPSHOT_TABLES.map((table) => [table, rows(backup, table)]));
}

async function saveSnapshot(
  transaction: ReturnType<typeof getD1>,
  scope: string,
  sourceOrigin: string,
  target: FullBackup,
  actor: MemberActor,
) {
  const id = crypto.randomUUID();
  await transaction.prepare(`
    INSERT INTO legacy_source_merge_backups
      (id, scope, source_origin, snapshot_json, created_by, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, scope, sourceOrigin, JSON.stringify(snapshotData(target)), actor.id, actor.displayName).run();
  return id;
}

function mapByStableKey(data: Row[], keyOf: (row: Row) => string) {
  const map = new Map<string, Row>();
  for (const row of data) {
    const stableKey = keyOf(row);
    if (stableKey && !map.has(stableKey)) map.set(stableKey, row);
  }
  return map;
}

async function mergeBudgets(
  transaction: ReturnType<typeof getD1>,
  source: FullBackup,
  target: FullBackup,
  actor: MemberActor,
) {
  const stats = { groupsAdded: 0, aliasesAdded: 0, linksAdded: 0, recordsLinked: 0, eventsAdded: 0, conflicts: [] as string[] };
  const targetGroups = new Map<string, Row>();
  for (const group of rows(target, "budget_name_groups")) targetGroups.set(key(group.canonical_key || group.canonical_name), group);
  const sourceGroupsById = new Map(rows(source, "budget_name_groups").map((group) => [integer(group.id), group]));
  const sourceToTargetGroup = new Map<number, number>();
  for (const sourceGroup of rows(source, "budget_name_groups").sort((a, b) => integer(a.sort_order) - integer(b.sort_order))) {
    const groupKey = key(sourceGroup.canonical_key || sourceGroup.canonical_name);
    let targetGroup = targetGroups.get(groupKey);
    if (!targetGroup) {
      const insertedGroup = await transaction.prepare(`
        INSERT INTO budget_name_groups (
          canonical_name, canonical_key, active, budget_kind, amount_mode,
          default_amount, sort_order, created_by, created_by_name,
          updated_by, updated_by_name, disabled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `).bind(
        text(sourceGroup.canonical_name),
        text(sourceGroup.canonical_key) || groupKey,
        integer(sourceGroup.active, 1),
        text(sourceGroup.budget_kind) || "purpose",
        text(sourceGroup.amount_mode) || "manual",
        sourceGroup.default_amount ?? null,
        integer(sourceGroup.sort_order),
        actor.id,
        actor.displayName,
        actor.id,
        actor.displayName,
        sourceGroup.disabled_at ?? null,
        sourceGroup.created_at ?? new Date().toISOString(),
        sourceGroup.updated_at ?? new Date().toISOString(),
      ).first<Row>();
      if (!insertedGroup) throw new Error(`표준 예산명 ${text(sourceGroup.canonical_name)} 등록에 실패했습니다.`);
      targetGroup = insertedGroup;
      targetGroups.set(groupKey, targetGroup);
      stats.groupsAdded += 1;
    }
    sourceToTargetGroup.set(integer(sourceGroup.id), integer(targetGroup.id));
  }

  const targetAliasByKey = new Map(rows(target, "budget_name_aliases").map((alias) => [key(alias.alias_key || alias.alias_name), alias]));
  for (const alias of rows(source, "budget_name_aliases")) {
    const aliasKey = key(alias.alias_key || alias.alias_name);
    const targetGroupId = sourceToTargetGroup.get(integer(alias.group_id));
    if (!aliasKey || !targetGroupId) continue;
    const existing = targetAliasByKey.get(aliasKey);
    if (existing) {
      if (integer(existing.group_id) !== targetGroupId) stats.conflicts.push(`별칭 '${text(alias.alias_name)}'은 다른 표준 예산명에 연결되어 있어 보존했습니다.`);
      continue;
    }
    await transaction.prepare(`
      INSERT INTO budget_name_aliases
        (group_id, alias_name, alias_key, active, created_by, created_by_name, disabled_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(alias_key) DO NOTHING
    `).bind(
      targetGroupId,
      text(alias.alias_name),
      text(alias.alias_key) || aliasKey,
      integer(alias.active, 1),
      actor.id,
      actor.displayName,
      alias.disabled_at ?? null,
      alias.created_at ?? new Date().toISOString(),
      alias.updated_at ?? new Date().toISOString(),
    ).run();
    stats.aliasesAdded += 1;
  }

  const sourceActivities = new Map(rows(source, "activities").map((row) => [integer(row.id), row]));
  const sourceProjects = new Map(rows(source, "equipment_projects").map((row) => [integer(row.id), row]));
  const targetActivities = mapByStableKey(rows(target, "activities"), activityStableKey);
  const targetProjects = mapByStableKey(rows(target, "equipment_projects"), projectStableKey);
  for (const member of rows(source, "budget_name_members")) {
    if (integer(member.active, 1) !== 1) continue;
    const targetGroupId = sourceToTargetGroup.get(integer(member.group_id));
    if (!targetGroupId) continue;
    const entityType = text(member.entity_type) === "equipment_project" ? "equipment_project" : "activity";
    const sourceEntity = entityType === "activity" ? sourceActivities.get(integer(member.entity_id)) : sourceProjects.get(integer(member.entity_id));
    const targetEntity = sourceEntity
      ? (entityType === "activity" ? targetActivities.get(activityStableKey(sourceEntity)) : targetProjects.get(projectStableKey(sourceEntity)))
      : undefined;
    if (!targetEntity) continue;
    const targetEntityId = integer(targetEntity.id);
    const existingGroupId = integer(targetEntity.budget_group_id);
    if (existingGroupId > 0 && existingGroupId !== targetGroupId) {
      stats.conflicts.push(`${entityType} ${targetEntityId}의 기존 표준 예산 연결을 보존했습니다.`);
      continue;
    }
    const table = entityType === "activity" ? "activities" : "equipment_projects";
    if (!existingGroupId) {
      await transaction.prepare(`
        UPDATE ${table}
        SET budget_group_id = ?, budget_type = ?,
            budget_original_name = COALESCE(NULLIF(budget_original_name, ''), ?),
            budget_match_status = 'matched', budget_match_method = 'legacy_source_merge'
        WHERE id = ? AND (budget_group_id IS NULL OR budget_group_id = 0)
      `).bind(
        targetGroupId,
        text(targetGroups.get(key(sourceGroupsById.get(integer(member.group_id))?.canonical_key))?.canonical_name),
        text(member.original_name),
        targetEntityId,
      ).run();
      stats.recordsLinked += 1;
    }
    const existing = await transaction.prepare(`
      SELECT id FROM budget_name_members
      WHERE entity_type = ? AND entity_id = ? AND active = 1
    `).bind(entityType, targetEntityId).first<Row>();
    if (!existing) {
      await transaction.prepare(`
        INSERT INTO budget_name_members
          (group_id, entity_type, entity_id, original_name, alias_key, active, linked_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).bind(targetGroupId, entityType, targetEntityId, text(member.original_name), text(member.alias_key), member.linked_at ?? new Date().toISOString()).run();
      stats.linksAdded += 1;
    }
  }

  const sourceMemberIndex = memberIndexes(source);
  const targetMemberIndex = memberIndexes(target);
  for (const event of rows(source, "budget_name_events")) {
    const targetGroupId = sourceToTargetGroup.get(integer(event.group_id)) ?? null;
    const changedByEmail = text(sourceMemberIndex.byId.get(integer(event.changed_by))?.email).toLowerCase();
    const changedBy = integer(targetMemberIndex.byEmail.get(changedByEmail)?.id, actor.id);
    const existing = await transaction.prepare(`
      SELECT id FROM budget_name_events
      WHERE COALESCE(group_id, 0) = COALESCE(?, 0) AND action = ?
        AND snapshot_json = ? AND COALESCE(request_id, '') = COALESCE(?, '')
        AND COALESCE(batch_key, '') = COALESCE(?, '') AND created_at = ?
    `).bind(targetGroupId, text(event.action), text(event.snapshot_json), event.request_id ?? null, event.batch_key ?? null, event.created_at).first<Row>();
    if (existing) continue;
    await transaction.prepare(`
      INSERT INTO budget_name_events
        (group_id, action, snapshot_json, request_id, batch_key, changed_by, changed_by_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(targetGroupId, text(event.action), text(event.snapshot_json), event.request_id ?? null, event.batch_key ?? null, changedBy, text(event.changed_by_name) || actor.displayName, event.created_at ?? new Date().toISOString()).run();
    stats.eventsAdded += 1;
  }
  return stats;
}

async function mergeMembersAndAssignments(
  transaction: ReturnType<typeof getD1>,
  source: FullBackup,
  target: FullBackup,
  actor: MemberActor,
) {
  const stats = { membersRestored: 0, duplicateAccountsRepointed: 0, activitiesRestored: 0, authorsRestored: 0, historyRestored: 0, schedulesRestored: 0, campaignTargetsRestored: 0, complexProjectsRestored: 0, lockedPreserved: 0, conflictsPreserved: 0 };
  const sourceMembers = memberIndexes(source);
  const targetMembers = memberIndexes(target, actor.id);
  const targetIdBySourceId = new Map<number, number>();

  for (const duplicates of targetMembers.byEmailAll.values()) {
    if (duplicates.length < 2) continue;
    const email = text(duplicates[0]?.email).toLowerCase();
    const canonical = targetMembers.byEmail.get(email);
    const canonicalId = integer(canonical?.id);
    if (!canonicalId) continue;
    for (const duplicate of duplicates) {
      const duplicateId = integer(duplicate.id);
      if (!duplicateId || duplicateId === canonicalId) continue;
      const updates = [
        ["UPDATE activity_authors SET member_id = ? WHERE member_id = ?", canonicalId, duplicateId],
        ["UPDATE activity_assignment_history SET to_member_id = ? WHERE to_member_id = ?", canonicalId, duplicateId],
        ["UPDATE activity_assignment_history SET changed_by_member_id = ? WHERE changed_by_member_id = ?", canonicalId, duplicateId],
        ["UPDATE organization_schedules SET assignee_member_id = ? WHERE assignee_member_id = ?", canonicalId, duplicateId],
        ["UPDATE sales_campaign_targets SET assigned_member_id = ? WHERE assigned_member_id = ?", canonicalId, duplicateId],
        ["UPDATE complex_projects SET manager_member_id = ? WHERE manager_member_id = ?", canonicalId, duplicateId],
      ] as const;
      for (const [sql, nextId, previousId] of updates) {
        const update = await transaction.prepare(sql).bind(nextId, previousId).run();
        stats.duplicateAccountsRepointed += Number(update.meta?.changes ?? 0);
      }
    }
  }
  for (const sourceMember of rows(source, "members")) {
    const email = text(sourceMember.email).toLowerCase();
    const targetMember = targetMembers.byEmail.get(email);
    if (!targetMember) continue;
    targetIdBySourceId.set(integer(sourceMember.id), integer(targetMember.id));
    if (text(sourceMember.status) === "approved" && integer(sourceMember.is_sales) === 1 && (text(targetMember.status) !== "approved" || integer(targetMember.is_sales) !== 1)) {
      await transaction.prepare(`
        UPDATE members SET status = 'approved', is_sales = 1,
          approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP), approved_by = COALESCE(approved_by, ?)
        WHERE id = ?
      `).bind(actor.id, integer(targetMember.id)).run();
      targetMember.status = "approved";
      targetMember.is_sales = 1;
      stats.membersRestored += 1;
    }
  }

  const sourceActivitiesById = new Map(rows(source, "activities").map((row) => [integer(row.id), row]));
  const targetActivitiesByKey = mapByStableKey(rows(target, "activities"), activityStableKey);
  const latestHistory = new Map<number, Row>();
  for (const history of rows(source, "activity_assignment_history").sort((a, b) => text(a.created_at).localeCompare(text(b.created_at)))) latestHistory.set(integer(history.activity_id), history);
  const authorByActivity = new Map(rows(source, "activity_authors").map((row) => [integer(row.activity_id), row]));
  const sourceEmailByAlias = sourceMembers.emailByAlias;
  const evidenceEmail = (activity: Row) => {
    const byName = sourceEmailByAlias.get(key(activity.progress_manager));
    if (byName) return byName;
    const history = latestHistory.get(integer(activity.id));
    const historyMember = history ? sourceMembers.byId.get(integer(history.to_member_id)) : undefined;
    if (historyMember) return text(historyMember.email).toLowerCase();
    const author = authorByActivity.get(integer(activity.id));
    const authorMember = author ? sourceMembers.byId.get(integer(author.member_id)) : undefined;
    return text(authorMember?.email).toLowerCase();
  };

  for (const sourceActivity of rows(source, "activities")) {
    const email = evidenceEmail(sourceActivity);
    const targetMember = targetMembers.byEmail.get(email);
    const targetActivity = targetActivitiesByKey.get(activityStableKey(sourceActivity));
    if (!targetMember || !targetActivity || integer(targetMember.is_sales) !== 1) continue;
    if (integer(targetActivity.progress_manager_locked) === 1) {
      stats.lockedPreserved += 1;
      continue;
    }
    const currentManager = text(targetActivity.progress_manager);
    const currentEmail = targetMembers.emailByAlias.get(key(currentManager));
    if (currentManager && currentManager !== "미지정" && currentEmail && currentEmail !== email) {
      stats.conflictsPreserved += 1;
      continue;
    }
    if (!currentManager || currentManager === "미지정" || currentEmail === email) {
      const displayName = text(targetMember.display_name);
      await transaction.prepare("UPDATE activities SET progress_manager = ? WHERE id = ? AND progress_manager_locked = 0")
        .bind(displayName, integer(targetActivity.id)).run();
      if (currentManager !== displayName) stats.activitiesRestored += 1;
    }
  }

  for (const sourceAuthor of rows(source, "activity_authors")) {
    const sourceActivity = sourceActivitiesById.get(integer(sourceAuthor.activity_id));
    const targetActivity = sourceActivity ? targetActivitiesByKey.get(activityStableKey(sourceActivity)) : undefined;
    const targetMemberId = targetIdBySourceId.get(integer(sourceAuthor.member_id));
    if (!targetActivity || !targetMemberId) continue;
    const existing = await transaction.prepare("SELECT member_id FROM activity_authors WHERE activity_id = ?").bind(integer(targetActivity.id)).first<Row>();
    if (!existing) {
      await transaction.prepare(`
        INSERT INTO activity_authors (activity_id, member_id, created_by_name, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(integer(targetActivity.id), targetMemberId, text(sourceAuthor.created_by_name), sourceAuthor.created_at ?? new Date().toISOString()).run();
      stats.authorsRestored += 1;
    } else if (!integer(existing.member_id)) {
      await transaction.prepare("UPDATE activity_authors SET member_id = ? WHERE activity_id = ? AND member_id IS NULL")
        .bind(targetMemberId, integer(targetActivity.id)).run();
      stats.authorsRestored += 1;
    }
  }

  for (const sourceHistory of rows(source, "activity_assignment_history")) {
    const sourceActivity = sourceActivitiesById.get(integer(sourceHistory.activity_id));
    const targetActivity = sourceActivity ? targetActivitiesByKey.get(activityStableKey(sourceActivity)) : undefined;
    const toMemberId = targetIdBySourceId.get(integer(sourceHistory.to_member_id));
    const changedById = targetIdBySourceId.get(integer(sourceHistory.changed_by_member_id)) ?? actor.id;
    if (!targetActivity || !toMemberId) continue;
    const existing = await transaction.prepare(`
      SELECT id FROM activity_assignment_history
      WHERE activity_id = ? AND to_member_id = ? AND to_manager = ? AND created_at = ?
    `).bind(integer(targetActivity.id), toMemberId, text(sourceHistory.to_manager), sourceHistory.created_at).first<Row>();
    if (existing) continue;
    await transaction.prepare(`
      INSERT INTO activity_assignment_history
        (activity_id, from_manager, to_member_id, to_manager, changed_by_member_id, changed_by_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(integer(targetActivity.id), text(sourceHistory.from_manager), toMemberId, text(sourceHistory.to_manager), changedById, text(sourceHistory.changed_by_name) || actor.displayName, sourceHistory.created_at ?? new Date().toISOString()).run();
    stats.historyRestored += 1;
  }

  const targetSchedules = mapByStableKey(rows(target, "organization_schedules"), scheduleStableKey);
  for (const sourceSchedule of rows(source, "organization_schedules")) {
    const targetSchedule = targetSchedules.get(scheduleStableKey(sourceSchedule));
    const targetMemberId = targetIdBySourceId.get(integer(sourceSchedule.assignee_member_id));
    if (!targetSchedule || !targetMemberId || integer(targetSchedule.assignee_member_id) > 0) continue;
    const targetMember = targetMembers.byId.get(targetMemberId);
    await transaction.prepare("UPDATE organization_schedules SET assignee_member_id = ?, assignee_name = ? WHERE id = ? AND assignee_member_id IS NULL")
      .bind(targetMemberId, text(targetMember?.display_name), integer(targetSchedule.id)).run();
    stats.schedulesRestored += 1;
  }

  const sourceCampaigns = new Map(rows(source, "sales_campaigns").map((row) => [integer(row.id), row]));
  const targetCampaigns = new Map(rows(target, "sales_campaigns").map((row) => [integer(row.id), row]));
  const targetCampaignTargets = mapByStableKey(rows(target, "sales_campaign_targets"), (row) => campaignTargetStableKey(row, targetCampaigns));
  for (const sourceTarget of rows(source, "sales_campaign_targets")) {
    const targetRow = targetCampaignTargets.get(campaignTargetStableKey(sourceTarget, sourceCampaigns));
    const targetMemberId = targetIdBySourceId.get(integer(sourceTarget.assigned_member_id));
    if (!targetRow || !targetMemberId || integer(targetRow.assigned_member_id) > 0) continue;
    await transaction.prepare("UPDATE sales_campaign_targets SET assigned_member_id = ? WHERE id = ? AND assigned_member_id IS NULL")
      .bind(targetMemberId, integer(targetRow.id)).run();
    stats.campaignTargetsRestored += 1;
  }

  const targetComplexProjects = mapByStableKey(rows(target, "complex_projects"), complexProjectStableKey);
  for (const sourceProject of rows(source, "complex_projects")) {
    const targetProject = targetComplexProjects.get(complexProjectStableKey(sourceProject));
    const targetMemberId = targetIdBySourceId.get(integer(sourceProject.manager_member_id));
    if (!targetProject || !targetMemberId || integer(targetProject.manager_member_id) > 0) continue;
    const targetMember = targetMembers.byId.get(targetMemberId);
    await transaction.prepare("UPDATE complex_projects SET manager_member_id = ?, manager_name = ? WHERE id = ? AND manager_member_id IS NULL")
      .bind(targetMemberId, text(targetMember?.display_name), integer(targetProject.id)).run();
    stats.complexProjectsRestored += 1;
  }
  return stats;
}

export async function mergeLegacySource(actor: MemberActor, currentOrigin?: string) {
  await ensureSnapshotTable();
  const [{ origin, backup: source }, target] = await Promise.all([
    fetchLegacyBackup(currentOrigin),
    createFullBackup(),
  ]);
  const d1 = getD1();
  const result = await d1.transaction(async (transaction) => {
    const backupId = await saveSnapshot(transaction, "budget-names-and-member-assignments", origin, target, actor);
    const budgets = await mergeBudgets(transaction, source, target, actor);
    const members = await mergeMembersAndAssignments(transaction, source, target, actor);
    return { backupId, budgets, members };
  });
  return {
    ok: true,
    sourceOrigin: origin,
    mergedAt: new Date().toISOString(),
    ...result,
    after: await compareLegacySource(currentOrigin),
  };
}

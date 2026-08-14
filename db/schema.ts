import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const activities = sqliteTable(
  "activities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seedKey: text("seed_key").unique(),
    activityDate: text("activity_date"),
    dateConfidence: text("date_confidence").notNull().default("확정"),
    activityType: text("activity_type").notNull(),
    category: text("category").notNull().default("외부"),
    contactMethod: text("contact_method").notNull().default(""),
    region: text("region").notNull().default(""),
    organization: text("organization").notNull(),
    businessRound: integer("business_round").notNull().default(1),
    budgetType: text("budget_type").notNull().default(""),
    budgetAmount: text("budget_amount").notNull().default(""),
    budgetOriginalName: text("budget_original_name").notNull().default(""),
    budgetGroupId: integer("budget_group_id"),
    budgetMatchStatus: text("budget_match_status")
      .notNull()
      .default("unclassified"),
    budgetMatchMethod: text("budget_match_method").notNull().default("legacy"),
    budgetRequestId: text("budget_request_id"),
    budgetKind: text("budget_kind").notNull().default("unclassified"),
    budgetAmountMode: text("budget_amount_mode").notNull().default("manual"),
    budgetAmountOverride: text("budget_amount_override")
      .notNull()
      .default(""),
    budgetsJson: text("budgets_json").notNull().default("[]"),
    topic: text("topic").notNull().default(""),
    summary: text("summary").notNull().default(""),
    detailLevel: text("detail_level").notNull().default("compact"),
    detailSummary: text("detail_summary").notNull().default(""),
    detailKeyFactsJson: text("detail_key_facts_json").notNull().default("[]"),
    detailSectionsJson: text("detail_sections_json").notNull().default("[]"),
    rawInput: text("raw_input").notNull().default(""),
    status: text("status").notNull().default("진행 중"),
    statusManual: integer("status_manual", { mode: "boolean" })
      .notNull()
      .default(false),
    temperature: text("temperature").notNull().default("중간"),
    awardStatus: text("award_status").notNull().default("미정"),
    awardCompany: text("award_company").notNull().default(""),
    executionType: text("execution_type").notNull().default("미정"),
    consortiumCompany: text("consortium_company").notNull().default(""),
    awardStage: text("award_stage").notNull().default("미정"),
    awardCompletedDate: text("award_completed_date").notNull().default(""),
    progressManager: text("progress_manager").notNull().default(""),
    progressManagerLocked: integer("progress_manager_locked", { mode: "boolean" })
      .notNull()
      .default(false),
    followUpRequired: integer("follow_up_required", { mode: "boolean" })
      .notNull()
      .default(true),
    followUpDate: text("follow_up_date"),
    nextAction: text("next_action").notNull().default(""),
    progressSchedule: text("progress_schedule").notNull().default(""),
    contactRole: text("contact_role").notNull().default(""),
    contactName: text("contact_name").notNull().default(""),
    contactPhone: text("contact_phone").notNull().default(""),
    contactEmail: text("contact_email").notNull().default(""),
    contactsJson: text("contacts_json").notNull().default("[]"),
    sourceChat: text("source_chat").notNull().default("ChatGPT 전체 내보내기"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("activities_organization_activity_idx").on(
      table.organization,
      table.activityDate,
      table.id,
    ),
    index("activities_manager_activity_idx").on(
      table.progressManager,
      table.activityDate,
      table.id,
    ),
    index("activities_award_organization_activity_idx").on(
      table.awardStatus,
      table.organization,
      table.activityDate,
      table.id,
    ),
    index("activities_award_business_round_idx").on(
      table.awardStatus,
      table.organization,
      table.businessRound,
      table.activityDate,
      table.id,
    ),
    index("activities_budget_group_idx").on(
      table.budgetGroupId,
      table.awardStatus,
      table.activityDate,
      table.id,
    ),
    index("activities_budget_request_idx").on(table.budgetRequestId, table.id),
    index("activities_progress_schedule_idx")
      .on(table.organization, table.activityDate, table.id)
      .where(sql`TRIM(COALESCE(${table.progressSchedule}, '')) <> ''`),
  ],
);

export const organizationSchedules = sqliteTable(
  "organization_schedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organization: text("organization").notNull(),
    businessRound: integer("business_round").notNull().default(1),
    label: text("label").notNull(),
    scheduledDate: text("scheduled_date").notNull(),
    startTime: text("start_time").notNull().default(""),
    endTime: text("end_time").notNull().default(""),
    category: text("category").notNull().default("general"),
    stage: text("stage").notNull().default(""),
    endDate: text("end_date").notNull().default(""),
    vendorName: text("vendor_name").notNull().default(""),
    content: text("content").notNull().default(""),
    details: text("details").notNull().default(""),
    completed: integer("completed", { mode: "boolean" })
      .notNull()
      .default(false),
    sourceActivityId: integer("source_activity_id"),
    complexDeliveryId: integer("complex_delivery_id"),
    assigneeMemberId: integer("assignee_member_id"),
    assigneeName: text("assignee_name").notNull().default(""),
    googleEventId: text("google_event_id").notNull().default(""),
    googleEventEtag: text("google_event_etag").notNull().default(""),
    googleOrigin: integer("google_origin", { mode: "boolean" }).notNull().default(false),
    syncStatus: text("sync_status").notNull().default("pending"),
    syncOperation: text("sync_operation").notNull().default("upsert"),
    syncError: text("sync_error").notNull().default(""),
    syncAttempts: integer("sync_attempts").notNull().default(0),
    lastSyncedAt: text("last_synced_at").notNull().default(""),
    googleUpdatedAt: text("google_updated_at").notNull().default(""),
    deletedAt: text("deleted_at").notNull().default(""),
    createdBy: integer("created_by"),
    createdByName: text("created_by_name").notNull().default(""),
    updatedBy: integer("updated_by"),
    updatedByName: text("updated_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("organization_schedules_scope_date_idx").on(
      table.organization,
      table.businessRound,
      table.completed,
      table.scheduledDate,
      table.id,
    ),
    index("organization_schedules_sync_idx").on(
      table.syncStatus,
      table.syncOperation,
      table.updatedAt,
      table.id,
    ),
    uniqueIndex("organization_schedules_google_event_idx").on(
      table.googleEventId,
    ).where(sql`${table.googleEventId} <> ''`),
    uniqueIndex("organization_schedules_active_local_identity_idx").on(
      sql`LOWER(TRIM(${table.organization}))`,
      table.businessRound,
      sql`LOWER(TRIM(${table.label}))`,
      table.scheduledDate,
      sql`LOWER(TRIM(COALESCE(${table.category}, 'general')))`,
    ).where(sql`
      COALESCE(${table.category}, 'general') <> 'construction'
      AND TRIM(COALESCE(${table.deletedAt}, '')) = ''
      AND TRIM(COALESCE(${table.googleEventId}, '')) = ''
    `),
    uniqueIndex("organization_schedules_active_local_semantic_identity_idx").on(
      sql`LOWER(TRIM(${table.organization}))`,
      table.businessRound,
      sql`REPLACE(
        REPLACE(
          REPLACE(
            LOWER(CASE
              WHEN INSTR(TRIM(${table.label}), ']') BETWEEN 1 AND 12
                THEN SUBSTR(TRIM(${table.label}), INSTR(TRIM(${table.label}), ']') + 1)
              ELSE TRIM(${table.label})
            END),
            ' ',
            ''
          ),
          REPLACE(LOWER(TRIM(${table.organization})), ' ', ''),
          ''
        ),
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          REPLACE(LOWER(TRIM(${table.organization})), ' ', ''),
          '특별자치도', ''), '특별자치시', ''), '광역시', ''), '특별시', ''),
          '도', ''), '시', ''), '군', ''), '구', ''),
        ''
      )`,
      table.scheduledDate,
      sql`LOWER(TRIM(COALESCE(${table.category}, 'general')))`,
    ).where(sql`
      COALESCE(${table.category}, 'general') <> 'construction'
      AND TRIM(COALESCE(${table.deletedAt}, '')) = ''
      AND TRIM(COALESCE(${table.googleEventId}, '')) = ''
    `),
    uniqueIndex("organization_schedules_complex_delivery_idx").on(
      table.complexDeliveryId,
    ).where(sql`${table.complexDeliveryId} IS NOT NULL`),
  ],
);

export const constructionScheduleProjects = sqliteTable(
  "construction_schedule_projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organization: text("organization").notNull(),
    businessRound: integer("business_round").notNull().default(1),
    workSummary: text("work_summary").notNull().default(""),
    workSummaryMode: text("work_summary_mode").notNull().default("auto"),
    completed: integer("completed", { mode: "boolean" })
      .notNull()
      .default(false),
    createdBy: integer("created_by"),
    createdByName: text("created_by_name").notNull().default(""),
    updatedBy: integer("updated_by"),
    updatedByName: text("updated_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("construction_schedule_projects_scope_idx").on(
      table.organization,
      table.businessRound,
    ),
  ],
);

export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  jobTitle: text("job_title").notNull().default(""),
  role: text("role").notNull().default("member"),
  permissions: text("permissions").notNull().default("[]"),
  status: text("status").notNull().default("pending"),
  isSales: integer("is_sales", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  approvedAt: text("approved_at"),
  approvedBy: integer("approved_by"),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  currentView: text("current_view").notNull().default(""),
});

export const memberCredentials = sqliteTable("member_credentials", {
  memberId: integer("member_id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull().default(100000),
  passwordSetAt: text("password_set_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: text("locked_until"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const memberSessions = sqliteTable(
  "member_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    memberId: integer("member_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    rememberMe: integer("remember_me", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("member_sessions_member_idx").on(table.memberId, table.expiresAt)],
);

export const memberPasswordResetRequests = sqliteTable(
  "member_password_reset_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id"),
    email: text("email").notNull(),
    status: text("status").notNull().default("pending"),
    requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: text("resolved_at"),
    resolvedBy: integer("resolved_by"),
  },
  (table) => [
    index("member_password_reset_status_idx").on(table.status, table.requestedAt),
  ],
);

export const dataControlEvents = sqliteTable(
  "data_control_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    action: text("action").notNull(),
    subject: text("subject").notNull().default(""),
    itemCount: integer("item_count").notNull().default(0),
    archiveIdsJson: text("archive_ids_json").notNull().default("[]"),
    actorMemberId: integer("actor_member_id").notNull(),
    actorName: text("actor_name").notNull().default(""),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("data_control_events_created_idx").on(table.createdAt, table.id),
  ],
);

export const activityAuthors = sqliteTable("activity_authors", {
  activityId: integer("activity_id").primaryKey(),
  memberId: integer("member_id"),
  createdByName: text("created_by_name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const quotationDocuments = sqliteTable(
  "quotation_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organization: text("organization").notNull(),
    businessRound: integer("business_round").notNull().default(1),
    companyName: text("company_name").notNull().default(""),
    quoteAmount: text("quote_amount").notNull().default(""),
    quoteDate: text("quote_date").notNull().default(""),
    originalName: text("original_name").notNull(),
    originalKey: text("original_key").notNull().unique(),
    originalSize: integer("original_size").notNull().default(0),
    pageKeysJson: text("page_keys_json").notNull().default("[]"),
    pageSizesJson: text("page_sizes_json").notNull().default("[]"),
    pageCount: integer("page_count").notNull().default(0),
    totalSize: integer("total_size").notNull().default(0),
    createdBy: integer("created_by").notNull(),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("quotation_documents_organization_idx").on(
      table.organization,
      table.createdAt,
    ),
  ],
);

export const deletionBatches = sqliteTable(
  "deletion_batches",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    displayName: text("display_name").notNull().default(""),
    itemCount: integer("item_count").notNull().default(0),
    snapshotJson: text("snapshot_json").notNull(),
    storedBytes: integer("stored_bytes").notNull().default(0),
    deletedByMemberId: integer("deleted_by_member_id").notNull(),
    deletedByName: text("deleted_by_name").notNull().default(""),
    deletedAt: text("deleted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
    restoredAt: text("restored_at"),
    restoredByMemberId: integer("restored_by_member_id"),
  },
  (table) => [
    index("deletion_batches_active_idx").on(
      table.restoredAt,
      table.expiresAt,
      table.deletedAt,
    ),
  ],
);

export const activityAssignmentHistory = sqliteTable(
  "activity_assignment_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    activityId: integer("activity_id").notNull(),
    fromManager: text("from_manager").notNull().default(""),
    toMemberId: integer("to_member_id").notNull(),
    toManager: text("to_manager").notNull(),
    changedByMemberId: integer("changed_by_member_id").notNull(),
    changedByName: text("changed_by_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("activity_assignment_history_activity_idx").on(
      table.activityId,
      table.createdAt,
    ),
  ],
);

export const activityChangeBatches = sqliteTable(
  "activity_change_batches",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull().default("awards"),
    operationLabel: text("operation_label").notNull().default(""),
    operationTotal: integer("operation_total").notNull().default(0),
    requestedFieldsJson: text("requested_fields_json").notNull().default("[]"),
    actorMemberId: integer("actor_member_id").notNull(),
    actorName: text("actor_name").notNull().default(""),
    itemCount: integer("item_count").notNull().default(0),
    status: text("status").notNull().default("in_progress"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
    undoneAt: text("undone_at"),
    undoneByMemberId: integer("undone_by_member_id"),
    undoneByName: text("undone_by_name").notNull().default(""),
    undoResultJson: text("undo_result_json").notNull().default("{}"),
  },
  (table) => [
    index("activity_change_batches_scope_created_idx").on(
      table.scope,
      table.createdAt,
    ),
  ],
);

export const activityChangeItems = sqliteTable(
  "activity_change_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: text("batch_id").notNull(),
    activityId: integer("activity_id").notNull(),
    organization: text("organization").notNull().default(""),
    requestedFieldsJson: text("requested_fields_json").notNull().default("[]"),
    changedFieldsJson: text("changed_fields_json").notNull().default("[]"),
    beforeJson: text("before_json").notNull().default("{}"),
    afterJson: text("after_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    undoneAt: text("undone_at"),
    undoneByMemberId: integer("undone_by_member_id"),
    undoneByName: text("undone_by_name").notNull().default(""),
    undoStatus: text("undo_status").notNull().default("pending"),
    undoResultJson: text("undo_result_json").notNull().default("{}"),
  },
  (table) => [
    uniqueIndex("activity_change_items_batch_activity_unique").on(
      table.batchId,
      table.activityId,
    ),
    index("activity_change_items_batch_idx").on(table.batchId, table.id),
  ],
);

export const managerAlertAcknowledgements = sqliteTable(
  "manager_alert_acknowledgements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id").notNull(),
    organization: text("organization").notNull(),
    issueSignature: text("issue_signature").notNull(),
    snoozedUntil: text("snoozed_until"),
    hiddenAt: text("hidden_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("manager_alert_ack_member_org_idx").on(
      table.memberId,
      table.organization,
    ),
  ],
);

export const activityReviewAcknowledgements = sqliteTable(
  "activity_review_acknowledgements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id").notNull(),
    activityId: integer("activity_id").notNull(),
    issueSignature: text("issue_signature").notNull(),
    snoozedUntil: text("snoozed_until"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("activity_review_ack_member_activity_idx").on(
      table.memberId,
      table.activityId,
    ),
  ],
);

export const aiRecommendations = sqliteTable(
  "ai_recommendations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    activityId: integer("activity_id").notNull(),
    organization: text("organization").notNull(),
    meetingSummary: text("meeting_summary").notNull().default(""),
    interestsJson: text("interests_json").notNull().default("[]"),
    recommendedProductsJson: text("recommended_products_json")
      .notNull()
      .default("[]"),
    followUpQuestionsJson: text("follow_up_questions_json")
      .notNull()
      .default("[]"),
    recommendedActionsJson: text("recommended_actions_json")
      .notNull()
      .default("[]"),
    appliedProductsJson: text("applied_products_json").notNull().default("[]"),
    appliedQuestionsJson: text("applied_questions_json").notNull().default("[]"),
    appliedActionsJson: text("applied_actions_json").notNull().default("[]"),
    followUpDate: text("follow_up_date"),
    createdBy: integer("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("ai_recommendations_activity_idx").on(table.activityId),
  ],
);

export const oauthClients = sqliteTable("oauth_clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: text("client_id").notNull().unique(),
  clientSecretHash: text("client_secret_hash").notNull(),
  name: text("name").notNull(),
  createdBy: integer("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  rotatedAt: text("rotated_at"),
});

export const oauthCodes = sqliteTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull(),
  memberId: integer("member_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  scope: text("scope").notNull().default("activities:write"),
  codeChallenge: text("code_challenge"),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const oauthTokens = sqliteTable("oauth_tokens", {
  accessTokenHash: text("access_token_hash").primaryKey(),
  refreshTokenHash: text("refresh_token_hash").notNull().unique(),
  clientId: text("client_id").notNull(),
  memberId: integer("member_id").notNull(),
  scope: text("scope").notNull().default("activities:write"),
  expiresAt: text("expires_at").notNull(),
  refreshExpiresAt: text("refresh_expires_at").notNull(),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: integer("updated_by"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const schoolDirectoryCredentials = sqliteTable(
  "school_directory_credentials",
  {
    id: integer("id").primaryKey(),
    encryptedKey: text("encrypted_key").notNull(),
    iv: text("iv").notNull(),
    keyLast4: text("key_last4").notNull(),
    updatedBy: integer("updated_by"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const officialSchoolCache = sqliteTable(
  "official_school_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    queryName: text("query_name").notNull(),
    region: text("region").notNull().default(""),
    resultsJson: text("results_json").notNull().default("[]"),
    fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("official_school_cache_fetched_idx").on(table.fetchedAt),
  ],
);

export const officialSchoolDirectory = sqliteTable(
  "official_school_directory",
  {
    schoolCode: text("school_code").primaryKey(),
    officeCode: text("office_code").notNull().default(""),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    kind: text("kind").notNull().default(""),
    region: text("region").notNull().default(""),
    regionKey: text("region_key").notNull().default(""),
    address: text("address").notNull().default(""),
    addressKey: text("address_key").notNull().default(""),
    phone: text("phone").notNull().default(""),
    coeducation: text("coeducation").notNull().default(""),
    fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("official_school_directory_name_idx").on(
      table.nameKey,
      table.regionKey,
    ),
    index("official_school_directory_region_idx").on(
      table.regionKey,
      table.nameKey,
    ),
  ],
);

export const organizationSchoolLinks = sqliteTable(
  "organization_school_links",
  {
    linkKey: text("link_key").primaryKey(),
    organization: text("organization").notNull(),
    organizationKey: text("organization_key").notNull(),
    contextKey: text("context_key").notNull().default(""),
    schoolCode: text("school_code").notNull(),
    matchSource: text("match_source").notNull().default("official-directory"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("organization_school_links_org_idx").on(
      table.organizationKey,
      table.contextKey,
    ),
    index("organization_school_links_school_idx").on(table.schoolCode),
  ],
);

export const officialSchoolSyncState = sqliteTable(
  "official_school_sync_state",
  {
    id: integer("id").primaryKey(),
    totalCount: integer("total_count").notNull().default(0),
    lastPage: integer("last_page").notNull().default(0),
    lastSyncedAt: text("last_synced_at").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const institutionNameDecisions = sqliteTable(
  "institution_name_decisions",
  {
    pairKey: text("pair_key").primaryKey(),
    leftKey: text("left_key").notNull(),
    rightKey: text("right_key").notNull(),
    leftOrganization: text("left_organization").notNull(),
    rightOrganization: text("right_organization").notNull(),
    decision: text("decision").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("institution_name_decisions_left_idx").on(table.leftKey),
    index("institution_name_decisions_right_idx").on(table.rightKey),
  ],
);

export const organizationLocations = sqliteTable("organization_locations", {
  organization: text("organization").primaryKey(),
  region: text("region").notNull().default(""),
  address: text("address").notNull().default(""),
  roadAddress: text("road_address").notNull().default(""),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  placeName: text("place_name").notNull().default(""),
  placeId: text("place_id").notNull().default(""),
  updatedBy: integer("updated_by"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const salesCampaigns = sqliteTable(
  "sales_campaigns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    notes: text("notes").notNull().default(""),
    budgetType: text("budget_type").notNull().default(""),
    budgetGroupId: integer("budget_group_id"),
    budgetMatchStatus: text("budget_match_status")
      .notNull()
      .default("unclassified"),
    budgetMatchMethod: text("budget_match_method").notNull().default("legacy"),
    budgetRequestId: text("budget_request_id"),
    budgetKind: text("budget_kind").notNull().default("unclassified"),
    budgetAmountMode: text("budget_amount_mode").notNull().default("manual"),
    selectionDate: text("selection_date").notNull().default(""),
    defaultBudgetAmount: integer("default_budget_amount"),
    sourceFileName: text("source_file_name").notNull().default(""),
    importSource: text("import_source").notNull().default(""),
    createdBy: integer("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("sales_campaigns_name_idx").on(table.name)],
);

export const salesCampaignTargets = sqliteTable(
  "sales_campaign_targets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignId: integer("campaign_id").notNull(),
    organization: text("organization").notNull(),
    region: text("region").notNull().default(""),
    address: text("address").notNull().default(""),
    phone: text("phone").notNull().default(""),
    contactName: text("contact_name").notNull().default(""),
    notes: text("notes").notNull().default(""),
    assignedMemberId: integer("assigned_member_id"),
    activityId: integer("activity_id"),
    budgetAmount: integer("budget_amount"),
    schoolLevel: text("school_level").notNull().default(""),
    supplyItems: text("supply_items").notNull().default(""),
    reviewNote: text("review_note").notNull().default(""),
    businessRound: integer("business_round").notNull().default(1),
    createdActivity: integer("created_activity").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("sales_campaign_targets_campaign_org_idx").on(
      table.campaignId,
      table.organization,
    ),
    index("sales_campaign_targets_org_round_campaign_idx").on(
      table.organization,
      table.businessRound,
      table.campaignId,
    ),
  ],
);

export const jointProjects = sqliteTable(
  "joint_projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    sponsorOrganization: text("sponsor_organization").notNull(),
    campaignId: integer("campaign_id"),
    budgetGroupId: integer("budget_group_id"),
    budgetType: text("budget_type").notNull().default(""),
    projectYear: integer("project_year").notNull().default(0),
    jointRound: integer("joint_round").notNull().default(1),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("active"),
    createdBy: integer("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("joint_projects_campaign_idx").on(table.campaignId, table.status),
    index("joint_projects_sponsor_idx").on(
      table.sponsorOrganization,
      table.status,
    ),
    index("joint_projects_budget_period_idx").on(
      table.budgetGroupId,
      table.projectYear,
      table.jointRound,
      table.status,
    ),
  ],
);

export const jointProjectMembers = sqliteTable(
  "joint_project_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").notNull(),
    organization: text("organization").notNull(),
    institutionKey: text("institution_key").notNull().default(""),
    businessRound: integer("business_round").notNull().default(1),
    role: text("role").notNull().default("site"),
    activityId: integer("activity_id"),
    campaignTargetId: integer("campaign_target_id"),
    budgetAmount: integer("budget_amount"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("joint_project_members_project_business_idx").on(
      table.projectId,
      table.organization,
      table.businessRound,
    ),
    index("joint_project_members_business_idx").on(
      table.organization,
      table.businessRound,
      table.projectId,
    ),
    index("joint_project_members_institution_idx").on(
      table.institutionKey,
      table.businessRound,
      table.projectId,
    ),
    index("joint_project_members_campaign_target_idx").on(
      table.campaignTargetId,
    ),
  ],
);

export const jointProjectEvents = sqliteTable(
  "joint_project_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").notNull(),
    action: text("action").notNull(),
    detailJson: text("detail_json").notNull().default("{}"),
    changedBy: integer("changed_by").notNull(),
    changedByName: text("changed_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("joint_project_events_project_idx").on(table.projectId)],
);

export const equipmentProjects = sqliteTable(
  "equipment_projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organization: text("organization").notNull(),
    businessRound: integer("business_round").notNull().default(1),
    name: text("name").notNull(),
    status: text("status").notNull().default("제안"),
    budgetType: text("budget_type").notNull().default(""),
    budgetOriginalName: text("budget_original_name").notNull().default(""),
    budgetGroupId: integer("budget_group_id"),
    budgetMatchStatus: text("budget_match_status")
      .notNull()
      .default("unclassified"),
    budgetMatchMethod: text("budget_match_method").notNull().default("legacy"),
    budgetRequestId: text("budget_request_id"),
    budgetKind: text("budget_kind").notNull().default("unclassified"),
    notes: text("notes").notNull().default(""),
    constructionAmount: integer("construction_amount"),
    actualConstructionCost: integer("actual_construction_cost"),
    activityId: integer("activity_id"),
    createdBy: integer("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("equipment_projects_org_round_name_idx").on(
      table.organization,
      table.businessRound,
      table.name,
    ),
    index("equipment_projects_activity_idx").on(
      table.activityId,
      table.updatedAt,
    ),
    index("equipment_projects_budget_group_idx").on(
      table.budgetGroupId,
      table.activityId,
      table.id,
    ),
  ],
);

export const equipmentItems = sqliteTable("equipment_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  productName: text("product_name").notNull(),
  specification: text("specification").notNull().default(""),
  proposedQty: integer("proposed_qty").notNull().default(0),
  awardedQty: integer("awarded_qty").notNull().default(0),
  installedQty: integer("installed_qty").notNull().default(0),
  unit: text("unit").notNull().default("대"),
  status: text("status").notNull().default("제안"),
  notes: text("notes").notNull().default(""),
  catalogItemId: text("catalog_item_id").notNull().default(""),
  catalogUnitPrice: integer("catalog_unit_price"),
  priceStatus: text("price_status").notNull().default("금액 미입력"),
  catalogNote: text("catalog_note").notNull().default(""),
  executionType: text("execution_type").notNull().default("직영"),
  commissionInputType: text("commission_input_type").notNull().default("rate"),
  commissionRate: real("commission_rate"),
  supplyType: text("supply_type").notNull().default("partner"),
  marginRate: real("margin_rate"),
  procurementFeeRate: real("procurement_fee_rate"),
  consortiumCommissionRate: real("consortium_commission_rate"),
  consortiumPaymentAmount: integer("consortium_payment_amount"),
  supplierVendorId: integer("supplier_vendor_id"),
  supplierVendorName: text("supplier_vendor_name").notNull().default(""),
  protectionStatus: text("protection_status").notNull().default("신청 필요"),
  protectionCompletedAt: text("protection_completed_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const complexProjects = sqliteTable(
  "complex_projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organization: text("organization").notNull(),
    businessRound: integer("business_round").notNull().default(1),
    name: text("name").notNull(),
    status: text("status").notNull().default("준비"),
    totalBudget: integer("total_budget"),
    sourceType: text("source_type").notNull().default("whizzup"),
    sourceAwardStatus: text("source_award_status").notNull().default("위즈업 수주"),
    managerMemberId: integer("manager_member_id"),
    managerName: text("manager_name").notNull().default(""),
    notes: text("notes").notNull().default(""),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: integer("created_by").notNull(),
    createdByName: text("created_by_name").notNull().default(""),
    updatedBy: integer("updated_by"),
    updatedByName: text("updated_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("complex_projects_scope_idx").on(table.organization, table.businessRound),
    index("complex_projects_active_idx").on(table.active, table.status, table.updatedAt, table.id),
    index("complex_projects_source_idx").on(table.sourceType, table.active, table.organization, table.businessRound),
  ],
);

export const complexProjectBudgetLinks = sqliteTable(
  "complex_project_budget_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    complexProjectId: integer("complex_project_id").notNull(),
    equipmentProjectId: integer("equipment_project_id").notNull(),
    allocatedAmount: integer("allocated_amount"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("complex_project_budget_links_scope_idx").on(table.complexProjectId, table.equipmentProjectId),
    index("complex_project_budget_links_project_idx").on(table.complexProjectId, table.sortOrder, table.id),
  ],
);

export const complexProjectZones = sqliteTable(
  "complex_project_zones",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    complexProjectId: integer("complex_project_id").notNull(),
    building: text("building").notNull().default(""),
    floor: text("floor").notNull().default(""),
    room: text("room").notNull().default(""),
    name: text("name").notNull(),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("complex_project_zones_project_idx").on(table.complexProjectId, table.sortOrder, table.id)],
);

export const complexProjectItemDetails = sqliteTable(
  "complex_project_item_details",
  {
    equipmentItemId: integer("equipment_item_id").primaryKey(),
    complexProjectId: integer("complex_project_id").notNull(),
    zoneId: integer("zone_id"),
    itemCategory: text("item_category").notNull().default("기자재"),
    procurementMethod: text("procurement_method").notNull().default(""),
    procurementIdentifier: text("procurement_identifier").notNull().default(""),
    deliveryLocation: text("delivery_location").notNull().default(""),
    selectionRound: text("selection_round").notNull().default(""),
    selectionStatus: text("selection_status").notNull().default(""),
    changeReason: text("change_reason").notNull().default(""),
    electricalRequirements: text("electrical_requirements").notNull().default(""),
    networkRequirements: text("network_requirements").notNull().default(""),
    protectionVendorName: text("protection_vendor_name").notNull().default(""),
    protectionState: text("protection_state").notNull().default("신청 필요"),
    protectionExpiresAt: text("protection_expires_at").notNull().default(""),
    updatedBy: integer("updated_by"),
    updatedByName: text("updated_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("complex_project_item_details_project_idx").on(table.complexProjectId, table.zoneId, table.equipmentItemId)],
);

export const complexProjectDeliveries = sqliteTable(
  "complex_project_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    complexProjectId: integer("complex_project_id").notNull(),
    equipmentItemId: integer("equipment_item_id").notNull(),
    scheduleId: integer("schedule_id"),
    kind: text("kind").notNull().default("납품"),
    plannedQty: integer("planned_qty").notNull().default(0),
    completedQty: integer("completed_qty").notNull().default(0),
    startDate: text("start_date").notNull().default(""),
    endDate: text("end_date").notNull().default(""),
    vendorName: text("vendor_name").notNull().default(""),
    location: text("location").notNull().default(""),
    status: text("status").notNull().default("일정 미정"),
    notes: text("notes").notNull().default(""),
    createdBy: integer("created_by"),
    createdByName: text("created_by_name").notNull().default(""),
    updatedBy: integer("updated_by"),
    updatedByName: text("updated_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("complex_project_deliveries_project_idx").on(table.complexProjectId, table.startDate, table.id),
    index("complex_project_deliveries_item_idx").on(table.equipmentItemId, table.status, table.id),
  ],
);

export const complexProjectEvents = sqliteTable(
  "complex_project_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    complexProjectId: integer("complex_project_id").notNull(),
    action: text("action").notNull(),
    detailJson: text("detail_json").notNull().default("{}"),
    changedBy: integer("changed_by").notNull(),
    changedByName: text("changed_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("complex_project_events_project_idx").on(table.complexProjectId, table.createdAt, table.id)],
);

export const resourcePosts = sqliteTable(
  "resource_posts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    category: text("category").notNull().default("기타"),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    createdBy: integer("created_by").notNull(),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    archivedAt: text("archived_at"),
    archivedBy: integer("archived_by"),
  },
  (table) => [
    index("resource_posts_active_idx").on(
      table.archivedAt,
      table.createdAt,
      table.id,
    ),
  ],
);

export const resourceAttachments = sqliteTable(
  "resource_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    postId: integer("post_id").notNull(),
    originalName: text("original_name").notNull(),
    driveFileId: text("drive_file_id").notNull().unique(),
    driveFolderId: text("drive_folder_id").notNull().default(""),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    sourceFingerprint: text("source_fingerprint").notNull().default(""),
    sourceRelativePath: text("source_relative_path").notNull().default(""),
    createdBy: integer("created_by").notNull(),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("resource_attachments_post_idx").on(
      table.postId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex("resource_attachments_source_fingerprint_idx")
      .on(table.sourceFingerprint)
      .where(sql`${table.sourceFingerprint} <> ''`),
  ],
);

export const youtubeResourceLinks = sqliteTable(
  "youtube_resource_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    videoId: text("video_id").notNull().unique(),
    youtubeUrl: text("youtube_url").notNull(),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    thumbnailUrl: text("thumbnail_url").notNull().default(""),
    kind: text("kind").notNull().default("video"),
    publishedAt: text("published_at").notNull().default(""),
    createdBy: integer("created_by").notNull(),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("youtube_resource_links_video_idx").on(table.videoId),
    index("youtube_resource_links_created_idx").on(table.createdAt, table.id),
  ],
);

export const youtubeChannelVideos = sqliteTable(
  "youtube_channel_videos",
  {
    videoId: text("video_id").primaryKey(),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    thumbnailUrl: text("thumbnail_url").notNull().default(""),
    youtubeUrl: text("youtube_url").notNull(),
    kind: text("kind").notNull().default("video"),
    publishedAt: text("published_at").notNull().default(""),
    active: integer("active").notNull().default(1),
    syncSource: text("sync_source").notNull().default(""),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("youtube_channel_videos_active_idx").on(table.active, table.publishedAt, table.videoId),
  ],
);

export const productVendorLinks = sqliteTable(
  "product_vendor_links",
  {
    productId: text("product_id").primaryKey(),
    vendorId: integer("vendor_id").notNull(),
    vendorNameSnapshot: text("vendor_name_snapshot").notNull().default(""),
    updatedBy: integer("updated_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("product_vendor_links_vendor_idx").on(
      table.vendorId,
      table.productId,
    ),
  ],
);

export const productSupplySettings = sqliteTable(
  "product_supply_settings",
  {
    productId: text("product_id").primaryKey(),
    supplyType: text("supply_type").notNull().default("partner"),
    marginRate: real("margin_rate"),
    updatedBy: integer("updated_by").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("product_supply_settings_type_idx").on(
      table.supplyType,
      table.productId,
    ),
  ],
);

export const budgetNameGroups = sqliteTable(
  "budget_name_groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    canonicalName: text("canonical_name").notNull(),
    canonicalKey: text("canonical_key").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    budgetKind: text("budget_kind").notNull().default("unclassified"),
    amountMode: text("amount_mode").notNull().default("manual"),
    defaultAmount: integer("default_amount"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: integer("created_by").notNull(),
    createdByName: text("created_by_name").notNull().default(""),
    updatedBy: integer("updated_by"),
    updatedByName: text("updated_by_name").notNull().default(""),
    disabledAt: text("disabled_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("budget_name_groups_active_key_idx").on(table.canonicalKey, table.active),
  ],
);

export const budgetNameAliases = sqliteTable(
  "budget_name_aliases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id").notNull(),
    aliasName: text("alias_name").notNull(),
    aliasKey: text("alias_key").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: integer("created_by"),
    createdByName: text("created_by_name").notNull().default(""),
    disabledAt: text("disabled_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("budget_name_aliases_group_idx").on(table.groupId, table.active),
    index("budget_name_aliases_active_key_idx").on(table.aliasKey, table.active),
  ],
);

export const budgetNameMembers = sqliteTable(
  "budget_name_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    originalName: text("original_name").notNull().default(""),
    aliasKey: text("alias_key").notNull().default(""),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    linkedAt: text("linked_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    unlinkedAt: text("unlinked_at"),
  },
  (table) => [
    uniqueIndex("budget_name_members_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
    index("budget_name_members_group_idx").on(table.groupId, table.active),
  ],
);

export const budgetNameEvents = sqliteTable(
  "budget_name_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id"),
    action: text("action").notNull(),
    snapshotJson: text("snapshot_json").notNull().default("{}"),
    requestId: text("request_id"),
    batchKey: text("batch_key").notNull().default(""),
    changedBy: integer("changed_by").notNull(),
    changedByName: text("changed_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("budget_name_events_group_idx").on(table.groupId, table.createdAt),
    index("budget_name_events_request_idx").on(table.requestId, table.createdAt),
  ],
);

export const budgetNameRequests = sqliteTable(
  "budget_name_requests",
  {
    id: text("id").primaryKey(),
    requestedName: text("requested_name").notNull(),
    requestedKey: text("requested_key").notNull(),
    expectedBudgetKind: text("expected_budget_kind")
      .notNull()
      .default("unclassified"),
    reason: text("reason").notNull().default(""),
    organization: text("organization").notNull().default(""),
    requesterMemberId: integer("requester_member_id").notNull(),
    requesterName: text("requester_name").notNull().default(""),
    status: text("status").notNull().default("pending"),
    resolvedGroupId: integer("resolved_group_id"),
    resolutionType: text("resolution_type").notNull().default(""),
    decisionReason: text("decision_reason").notNull().default(""),
    decidedBy: integer("decided_by"),
    decidedByName: text("decided_by_name").notNull().default(""),
    decidedAt: text("decided_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("budget_name_requests_status_key_idx").on(
      table.status,
      table.requestedKey,
      table.createdAt,
    ),
    index("budget_name_requests_requester_idx").on(
      table.requesterMemberId,
      table.createdAt,
    ),
  ],
);

export const budgetNameRequestRecords = sqliteTable(
  "budget_name_request_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: text("request_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    originalName: text("original_name").notNull().default(""),
    organization: text("organization").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("budget_name_request_records_entity_unique").on(
      table.requestId,
      table.entityType,
      table.entityId,
    ),
    index("budget_name_request_records_request_idx").on(
      table.requestId,
      table.id,
    ),
    index("budget_name_request_records_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
  ],
);

export const accountingSettlements = sqliteTable(
  "accounting_settlements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    activityId: integer("activity_id").notNull().unique(),
    confirmedContractAmount: integer("confirmed_contract_amount"),
    depositAmount: integer("deposit_amount").notNull().default(0),
    interimAmount: integer("interim_amount").notNull().default(0),
    balanceAmount: integer("balance_amount").notNull().default(0),
    paidAmount: integer("paid_amount").notNull().default(0),
    actualCost: integer("actual_cost"),
    confirmedCommission: integer("confirmed_commission"),
    confirmedMargin: integer("confirmed_margin"),
    manufacturerCommissionExpected: integer("manufacturer_commission_expected"),
    manufacturerCommissionReceived: integer("manufacturer_commission_received").notNull().default(0),
    manufacturerCommissionReceivedDate: text("manufacturer_commission_received_date"),
    consortiumPaymentExpected: integer("consortium_payment_expected"),
    consortiumPaymentPaid: integer("consortium_payment_paid").notNull().default(0),
    consortiumPaymentDate: text("consortium_payment_date"),
    otherCost: integer("other_cost").notNull().default(0),
    commissionReceivable: integer("commission_receivable").notNull().default(0),
    consortiumPayable: integer("consortium_payable").notNull().default(0),
    netRevenue: integer("net_revenue"),
    recognizedDate: text("recognized_date"),
    invoiceStatus: text("invoice_status").notNull().default("미발행"),
    invoiceDate: text("invoice_date"),
    settlementStatus: text("settlement_status").notNull().default("확인 필요"),
    accountingNote: text("accounting_note").notNull().default(""),
    confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
    updatedBy: integer("updated_by").notNull(),
    updatedByName: text("updated_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("accounting_settlements_recognized_idx").on(
      table.recognizedDate,
      table.settlementStatus,
    ),
  ],
);

export const accountingSettlementHistory = sqliteTable(
  "accounting_settlement_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    settlementId: integer("settlement_id").notNull(),
    activityId: integer("activity_id").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    changedFieldsJson: text("changed_fields_json").notNull().default("[]"),
    changedBy: integer("changed_by").notNull(),
    changedByName: text("changed_by_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("accounting_history_activity_idx").on(
      table.activityId,
      table.createdAt,
    ),
  ],
);

export const authoredQuotations = sqliteTable(
  "authored_quotations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    quoteNumber: text("quote_number").notNull().unique(),
    revisionRootId: integer("revision_root_id").notNull().default(0),
    revisionParentId: integer("revision_parent_id").notNull().default(0),
    revisionNumber: integer("revision_number").notNull().default(0),
    organization: text("organization").notNull(),
    businessRound: integer("business_round").notNull().default(1),
    projectTitle: text("project_title").notNull().default(""),
    quoteDate: text("quote_date").notNull(),
    validUntil: text("valid_until").notNull().default(""),
    status: text("status").notNull().default("draft"),
    executionType: text("execution_type").notNull().default("직영"),
    consortiumCompany: text("consortium_company").notNull().default(""),
    consortiumRate: text("consortium_rate").notNull().default("0"),
    discountAmount: integer("discount_amount").notNull().default(0),
    extraAmount: integer("extra_amount").notNull().default(0),
    additionalInternalConstructionCost: integer("additional_internal_construction_cost").notNull().default(0),
    subtotalAmount: integer("subtotal_amount").notNull().default(0),
    supplyAmount: integer("supply_amount").notNull().default(0),
    taxAmount: integer("tax_amount").notNull().default(0),
    totalAmount: integer("total_amount").notNull().default(0),
    expectedEarning: integer("expected_earning").notNull().default(0),
    consortiumPayment: integer("consortium_payment").notNull().default(0),
    marginAmount: integer("margin_amount").notNull().default(0),
    marginRate: text("margin_rate").notNull().default("0"),
    includeStamp: integer("include_stamp", { mode: "boolean" })
      .notNull()
      .default(false),
    memo: text("memo").notNull().default(""),
    itemsJson: text("items_json").notNull().default("[]"),
    budgetsJson: text("budgets_json").notNull().default("[]"),
    settlementAdjustmentsJson: text("settlement_adjustments_json").notNull().default("[]"),
    drivePdfFileId: text("drive_pdf_file_id").notNull().default(""),
    drivePdfName: text("drive_pdf_name").notNull().default(""),
    driveXlsxFileId: text("drive_xlsx_file_id").notNull().default(""),
    driveXlsxName: text("drive_xlsx_name").notNull().default(""),
    driveSyncStatus: text("drive_sync_status").notNull().default("none"),
    driveSyncError: text("drive_sync_error").notNull().default(""),
    deletedAt: text("deleted_at").notNull().default(""),
    deletedBy: integer("deleted_by").notNull().default(0),
    deletedByName: text("deleted_by_name").notNull().default(""),
    createdBy: integer("created_by").notNull(),
    createdByName: text("created_by_name").notNull().default(""),
    updatedBy: integer("updated_by").notNull(),
    updatedByName: text("updated_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("authored_quotations_org_date_idx").on(
      table.organization,
      table.businessRound,
      table.quoteDate,
      table.id,
    ),
    index("authored_quotations_revision_idx").on(
      table.revisionRootId,
      table.revisionNumber,
      table.id,
    ),
    index("authored_quotations_deleted_idx").on(
      table.deletedAt,
      table.quoteDate,
      table.id,
    ),
  ],
);

export const inventoryProducts = sqliteTable(
  "inventory_products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    specification: text("specification").notNull().default(""),
    unit: text("unit").notNull().default("대"),
    currentStock: integer("current_stock").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(1),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdBy: integer("created_by"),
    createdByName: text("created_by_name").notNull().default(""),
    updatedBy: integer("updated_by"),
    updatedByName: text("updated_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("inventory_products_name_idx").on(table.name),
  ],
);

export const inventoryTransactions = sqliteTable(
  "inventory_transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id").notNull(),
    transactionType: text("transaction_type").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    resultingStock: integer("resulting_stock").notNull(),
    reference: text("reference").notNull().default(""),
    note: text("note").notNull().default(""),
    transactionDate: text("transaction_date").notNull(),
    createdBy: integer("created_by"),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("inventory_transactions_product_date_idx").on(
      table.productId,
      table.transactionDate,
      table.id,
    ),
    index("inventory_transactions_date_idx").on(
      table.transactionDate,
      table.id,
    ),
  ],
);

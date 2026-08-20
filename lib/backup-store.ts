import { getD1, isPostgresDatabase } from "../db";
import { ensureCampaignsReady } from "./campaign-store";
import {
  ensureCollaborationReady,
  type Member,
} from "./collaboration";
import { ensureEquipmentReady } from "./equipment-store";
import { ensureMapReady } from "./map-store";
import { ensureManagerAlertsReady } from "./manager-alerts";
import { ensureActivityReviewsReady } from "./activity-reviews";
import { ensureActivityAssignmentHistoryReady } from "./activity-assignment-history";
import { ensureActivityChangeLedgerReady } from "./activity-change-ledger";
import { ensureRecordsReady } from "./records-store";
import { ensureAiRecommendationsReady } from "./ai-recommendations";
import { ensureInstitutionDecisionsReady } from "./institution-decisions";
import { ensureAccountingReady } from "./accounting-store";
import { ensureProductVendorLinksReady } from "./product-vendor-links";
import { ensureBudgetNamesReady } from "./budget-names";
import { normalizeAwardStage } from "./sales-taxonomy";
import { ensureDataControlReady } from "./data-control-store";
import { ensureAwardVendorsReady } from "./award-vendors";
import { ensureQuotationDocumentsReady } from "./quotation-documents";
import { ensureSchoolDirectoryReady } from "./school-directory";
import { ensureJointProjectsReady } from "./joint-projects";
import { ensureInventoryReady } from "./inventory-store";
import { ensureOrganizationSchedulesReady } from "./organization-schedules";
import { ensureAuthoredQuotationsReady } from "./authored-quotations";
import { ensureComplexProjectsReady } from "./complex-projects";
import { ensureResourceLibraryReady } from "./resource-library";
import { ensureYouTubeResourceLibraryReady } from "./youtube-resource-library";
import { ensureProductComparisonDocumentsReady } from "./product-comparison-documents";

export const BACKUP_FORMAT = "whizzup-full-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_SCHEMA_VERSION = "2026-08-14-safe-drive-backup";
const LEGACY_BACKUP_SCHEMA_VERSIONS = new Set([
  "2026-08-14-drive-complete-business",
  "2026-08-11-youtube-resource-links",
  "2026-08-09-product-resource-import",
  "2026-08-09-google-drive-library",
  "2026-08-07-complex-project-controls",
  "2026-08-07-complex-projects",
  "2026-08-03-construction-schedule-board",
  "2026-08-03-authored-quotations",
  "2026-08-03-organization-schedules",
  "2026-08-03-inventory-ledger",
  "2026-08-02-joint-budget-period",
  "2026-08-02-complete-business-backup",
  "2026-07-31-activity-details",
  "2026-07-30-owner-data-controls",
  "2026-07-18",
  "2026-07-20",
  "2026-07-21",
  "2026-07-21-institution-directory",
  "2026-07-22-equipment-consortium",
  "2026-07-22-equipment-dual-commission",
  "2026-07-22-equipment-quote-costs",
  "2026-07-23-accounting-commission-ledger",
  "2026-07-23-accounting-collection-receipts",
  "2026-07-24-business-rounds",
  "2026-07-26-product-vendor-links",
  "2026-07-26-budget-name-groups",
  "2026-07-27-award-completion-dates",
  "2026-07-28-equipment-price-status",
  "2026-07-28-manual-sales-status",
  "2026-07-29-product-supply-accounting",
  "2026-07-29-standard-budget-catalog",
  "2026-07-30-budget-campaign-portfolio",
  "2026-07-30-progress-manager-control",
]);
const PRE_BUDGET_NAME_SCHEMA_VERSIONS = new Set([
  "2026-07-18",
  "2026-07-20",
  "2026-07-21",
  "2026-07-21-institution-directory",
  "2026-07-22-equipment-consortium",
  "2026-07-22-equipment-dual-commission",
  "2026-07-22-equipment-quote-costs",
  "2026-07-23-accounting-commission-ledger",
  "2026-07-23-accounting-collection-receipts",
  "2026-07-24-business-rounds",
  "2026-07-26-product-vendor-links",
]);
const BUDGET_NAME_BACKUP_TABLES = new Set([
  "budget_name_groups",
  "budget_name_aliases",
  "budget_name_members",
  "budget_name_events",
  "budget_name_deleted_audit",
  "budget_name_review_exclusions",
]);
const LEGACY_BUDGET_NAME_NOTICE =
  "이 백업은 표준 예산명 기능 도입 이전 형식입니다. 복원 시 현재 표준 예산명과 별칭은 유지하고, 당시 활동·지도·품목 등 포함 자료만 복원합니다.";
const LEGACY_COMPLETE_BUSINESS_NOTICE =
  "이 백업은 견적서·협력사 문서·학교 연결·휴지통·홀덤 순위가 전체 DB 백업에 포함되기 전 형식입니다. 복원 시 해당 현재 자료는 지우지 않고 유지합니다.";
export const BACKUP_MAX_ROWS = 20_000;

const COMPLETE_BUSINESS_BACKUP_TABLES = new Set([
  "quotation_documents",
  "authored_quotations",
  "award_vendor_documents",
  "organization_school_links",
  "deletion_batches",
  "holdem_weekly_scores",
]);
const JOINT_PROJECT_BACKUP_TABLES = new Set([
  "joint_projects",
  "joint_project_members",
  "joint_project_events",
]);
const INVENTORY_BACKUP_TABLES = new Set([
  "inventory_products",
  "inventory_transactions",
]);
const ORGANIZATION_SCHEDULE_BACKUP_TABLES = new Set([
  "organization_schedules",
  "construction_schedule_projects",
]);
const COMPLEX_PROJECT_BACKUP_TABLES = new Set([
  "complex_projects",
  "complex_project_budget_links",
  "complex_project_zones",
  "complex_project_item_details",
  "complex_project_deliveries",
  "complex_project_events",
]);
const DRIVE_LIBRARY_BACKUP_TABLES = new Set([
  "resource_posts",
  "resource_attachments",
  "youtube_resource_links",
  "product_comparison_documents",
]);
const DURABLE_AUTH_HISTORY_BACKUP_TABLES = new Set([
  "member_rejections",
  "member_account_archives",
]);

export const EXCLUDED_DATABASE_TABLES = new Set([
  "api_credentials",
  "award_vendor_migrations",
  "business_round_rollover_repair_backups",
  "legacy_source_merge_backups",
  "local_auth_sessions",
  "member_credentials",
  "member_identity_migrations",
  "member_password_reset_requests",
  "member_sessions",
  "oauth_clients",
  "oauth_codes",
  "oauth_tokens",
  "object_storage_files",
  "official_school_cache",
  "official_school_directory",
  "official_school_sync_state",
  "organization_schedule_import_state",
  "progress_manager_campaign_repair_backups",
  "progress_manager_repair_backups",
  "school_directory_credentials",
  "vercel_schema_migrations",
  "youtube_channel_videos",
]);

function legacyBackupMayOmitTable(
  schemaVersion: string,
  tableName: string,
) {
  return (
    (PRE_BUDGET_NAME_SCHEMA_VERSIONS.has(schemaVersion) &&
      BUDGET_NAME_BACKUP_TABLES.has(tableName)) ||
    (schemaVersion !== BACKUP_SCHEMA_VERSION &&
      (COMPLETE_BUSINESS_BACKUP_TABLES.has(tableName) ||
        JOINT_PROJECT_BACKUP_TABLES.has(tableName) ||
        INVENTORY_BACKUP_TABLES.has(tableName) ||
        ORGANIZATION_SCHEDULE_BACKUP_TABLES.has(tableName) ||
        COMPLEX_PROJECT_BACKUP_TABLES.has(tableName) ||
        DRIVE_LIBRARY_BACKUP_TABLES.has(tableName) ||
        DURABLE_AUTH_HISTORY_BACKUP_TABLES.has(tableName)))
  );
}

type BackupRow = Record<string, unknown>;

type BackupTableDefinition = {
  name: string;
  columns: readonly string[];
  orderBy: string;
};

export const BACKUP_TABLES = [
  {
    name: "members",
    columns: [
      "id",
      "sync_id",
      "auth_user_id",
      "username",
      "email",
      "display_name",
      "job_title",
      "role",
      "permissions",
      "status",
      "is_sales",
      "created_at",
      "approved_at",
      "approved_by",
      "last_seen_at",
      "current_view",
    ],
    orderBy: "id",
  },
  {
    name: "activities",
    columns: [
      "id",
      "sync_id",
      "seed_key",
      "activity_date",
      "date_confidence",
      "activity_type",
      "category",
      "contact_method",
      "region",
      "organization",
      "business_round",
      "budget_type",
      "budget_amount",
      "budget_original_name",
      "budget_group_id",
      "budget_match_status",
      "budget_match_method",
      "budget_request_id",
      "budget_kind",
      "budget_amount_mode",
      "budget_amount_override",
      "budgets_json",
      "topic",
      "summary",
      "detail_level",
      "detail_summary",
      "detail_key_facts_json",
      "detail_sections_json",
      "raw_input",
      "status",
      "status_manual",
      "temperature",
      "award_status",
      "award_status_explicit",
      "award_company",
      "execution_type",
      "consortium_company",
      "award_stage",
      "award_stage_manual",
      "award_completed_date",
      "progress_manager",
      "progress_manager_locked",
      "follow_up_required",
      "follow_up_date",
      "next_action",
      "progress_schedule",
      "contact_role",
      "contact_name",
      "contact_phone",
      "contact_email",
      "contacts_json",
      "source_chat",
      "notes",
      "updated_by_member_id",
      "updated_by_name",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "institution_registry",
    columns: [
      "organization",
      "region",
      "created_by",
      "created_by_name",
      "created_at",
      "updated_at",
    ],
    orderBy: "organization",
  },
  {
    name: "activity_authors",
    columns: ["activity_id", "member_id", "created_by_name", "created_at"],
    orderBy: "activity_id",
  },
  {
    name: "activity_assignment_history",
    columns: [
      "id",
      "activity_id",
      "from_manager",
      "to_member_id",
      "to_manager",
      "changed_by_member_id",
      "changed_by_name",
      "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "activity_change_batches",
    columns: [
      "id",
      "scope",
      "operation_label",
      "operation_total",
      "requested_fields_json",
      "actor_member_id",
      "actor_name",
      "item_count",
      "status",
      "created_at",
      "updated_at",
      "completed_at",
      "undone_at",
      "undone_by_member_id",
      "undone_by_name",
      "undo_result_json",
    ],
    orderBy: "created_at, id",
  },
  {
    name: "activity_change_items",
    columns: [
      "id",
      "batch_id",
      "activity_id",
      "organization",
      "requested_fields_json",
      "changed_fields_json",
      "before_json",
      "after_json",
      "created_at",
      "undone_at",
      "undone_by_member_id",
      "undone_by_name",
      "undo_status",
      "undo_result_json",
    ],
    orderBy: "id",
  },
  {
    name: "manager_alert_acknowledgements",
    columns: [
      "id",
      "member_id",
      "organization",
      "issue_signature",
      "snoozed_until",
      "hidden_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "data_control_events",
    columns: [
      "id",
      "action",
      "subject",
      "item_count",
      "archive_ids_json",
      "actor_member_id",
      "actor_name",
      "details_json",
      "created_at",
    ],
    orderBy: "created_at, id",
  },
  {
    name: "deletion_batches",
    columns: [
      "id",
      "entity_type",
      "display_name",
      "item_count",
      "snapshot_json",
      "stored_bytes",
      "deleted_by_member_id",
      "deleted_by_name",
      "deleted_at",
      "expires_at",
      "restored_at",
      "restored_by_member_id",
    ],
    orderBy: "deleted_at, id",
  },
  {
    name: "activity_review_acknowledgements",
    columns: [
      "id",
      "member_id",
      "activity_id",
      "issue_signature",
      "snoozed_until",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "ai_recommendations",
    columns: [
      "id",
      "activity_id",
      "organization",
      "meeting_summary",
      "interests_json",
      "recommended_products_json",
      "follow_up_questions_json",
      "recommended_actions_json",
      "applied_products_json",
      "applied_questions_json",
      "applied_actions_json",
      "follow_up_date",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "app_settings",
    columns: ["key", "value", "updated_by", "updated_at"],
    orderBy: "key",
  },
  {
    name: "award_vendors",
    columns: [
      "id",
      "company_name",
      "business_number",
      "representative_name",
      "business_type",
      "business_item",
      "address",
      "phone",
      "email",
      "bank_name",
      "account_number",
      "account_holder",
      "contact_name",
      "contact_title",
      "contact_phone",
      "contact_email",
      "notes",
      "is_active",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "award_vendor_documents",
    columns: [
      "id",
      "vendor_id",
      "document_type",
      "original_name",
      "object_key",
      "content_type",
      "size_bytes",
      "extracted_json",
      "created_by",
      "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "product_vendor_links",
    columns: [
      "product_id",
      "vendor_id",
      "vendor_name_snapshot",
      "updated_by",
      "created_at",
      "updated_at",
    ],
    orderBy: "product_id",
  },
  {
    name: "product_supply_settings",
    columns: [
      "product_id",
      "supply_type",
      "margin_rate",
      "updated_by",
      "created_at",
      "updated_at",
    ],
    orderBy: "product_id",
  },
  {
    name: "budget_name_groups",
    columns: [
      "id",
      "canonical_name",
      "canonical_key",
      "active",
      "budget_kind",
      "amount_mode",
      "default_amount",
      "sort_order",
      "created_by",
      "created_by_name",
      "updated_by",
      "updated_by_name",
      "disabled_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "budget_name_aliases",
    columns: [
      "id",
      "group_id",
      "alias_name",
      "alias_key",
      "active",
      "created_by",
      "created_by_name",
      "disabled_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "budget_name_members",
    columns: [
      "id",
      "group_id",
      "entity_type",
      "entity_id",
      "original_name",
      "alias_key",
      "active",
      "linked_at",
      "unlinked_at",
    ],
    orderBy: "id",
  },
  {
    name: "budget_name_events",
    columns: [
      "id",
      "group_id",
      "action",
      "snapshot_json",
      "request_id",
      "batch_key",
      "changed_by",
      "changed_by_name",
      "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "budget_name_deleted_audit",
    columns: [
      "id",
      "deleted_group_id",
      "canonical_name",
      "canonical_key",
      "snapshot_json",
      "deleted_by",
      "deleted_by_name",
      "deleted_at",
    ],
    orderBy: "id",
  },
  {
    name: "budget_name_review_exclusions",
    columns: [
      "entity_type",
      "entity_id",
      "original_name",
      "excluded_by",
      "excluded_by_name",
      "excluded_at",
      "restored_by",
      "restored_by_name",
      "restored_at",
    ],
    orderBy: "excluded_at, entity_type, entity_id",
  },
  {
    name: "budget_name_requests",
    columns: [
      "id",
      "requested_name",
      "requested_key",
      "expected_budget_kind",
      "reason",
      "organization",
      "requester_member_id",
      "requester_name",
      "status",
      "resolved_group_id",
      "resolution_type",
      "decision_reason",
      "decided_by",
      "decided_by_name",
      "decided_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "created_at, id",
  },
  {
    name: "budget_name_request_records",
    columns: [
      "id",
      "request_id",
      "entity_type",
      "entity_id",
      "original_name",
      "organization",
      "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "institution_name_decisions",
    columns: [
      "pair_key",
      "left_key",
      "right_key",
      "left_organization",
      "right_organization",
      "decision",
      "updated_at",
    ],
    orderBy: "pair_key",
  },
  {
    name: "organization_school_links",
    columns: [
      "link_key",
      "organization",
      "organization_key",
      "context_key",
      "school_code",
      "match_source",
      "updated_at",
    ],
    orderBy: "link_key",
  },
  {
    name: "quotation_documents",
    columns: [
      "id",
      "organization",
      "business_round",
      "company_name",
      "quote_amount",
      "quote_date",
      "original_name",
      "original_key",
      "original_size",
      "page_keys_json",
      "page_sizes_json",
      "page_count",
      "total_size",
      "created_by",
      "created_by_name",
      "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "resource_posts",
    columns: [
      "id",
      "category",
      "title",
      "content",
      "created_by",
      "created_by_name",
      "created_at",
      "updated_at",
      "archived_at",
      "archived_by",
    ],
    orderBy: "id",
  },
  {
    name: "resource_attachments",
    columns: [
      "id",
      "post_id",
      "original_name",
      "drive_file_id",
      "drive_folder_id",
      "mime_type",
      "size_bytes",
      "source_fingerprint",
      "source_relative_path",
      "created_by",
      "created_by_name",
      "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "youtube_resource_links",
    columns: [
      "id",
      "video_id",
      "youtube_url",
      "title",
      "description",
      "thumbnail_url",
      "kind",
      "published_at",
      "created_by",
      "created_by_name",
      "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "product_comparison_documents",
    columns: [
      "id",
      "equipment_item_id",
      "catalog_product_id",
      "product_name",
      "original_name",
      "drive_file_id",
      "drive_folder_id",
      "mime_type",
      "size_bytes",
      "created_by",
      "created_by_name",
      "created_at",
      "archived_at",
    ],
    orderBy: "id",
  },
  {
    name: "organization_locations",
    columns: [
      "organization",
      "sync_id",
      "region",
      "address",
      "road_address",
      "latitude",
      "longitude",
      "place_name",
      "place_id",
      "updated_by",
      "updated_at",
    ],
    orderBy: "organization",
  },
  {
    name: "sales_campaigns",
    columns: [
      "id",
      "sync_id",
      "name",
      "notes",
      "budget_type",
      "budget_group_id",
      "budget_match_status",
      "budget_match_method",
      "budget_request_id",
      "budget_kind",
      "budget_amount_mode",
      "selection_date",
      "default_budget_amount",
      "source_file_name",
      "import_source",
      "import_status",
      "expected_target_count",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "sales_campaign_targets",
    columns: [
      "id",
      "sync_id",
      "campaign_id",
      "organization",
      "region",
      "address",
      "phone",
      "contact_name",
      "notes",
      "assigned_member_id",
      "activity_id",
      "budget_amount",
      "school_level",
      "supply_items",
      "review_note",
      "business_round",
      "created_activity",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "inventory_products",
    columns: [
      "id",
      "name",
      "specification",
      "unit",
      "current_stock",
      "low_stock_threshold",
      "is_active",
      "created_by",
      "created_by_name",
      "updated_by",
      "updated_by_name",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "authored_quotations",
    columns: [
      "id",
      "quote_number",
      "revision_root_id",
      "revision_parent_id",
      "revision_number",
      "organization",
      "business_round",
      "project_title",
      "quote_date",
      "valid_until",
      "status",
      "execution_type",
      "consortium_company",
      "consortium_rate",
      "discount_amount",
      "extra_amount",
      "additional_internal_construction_cost",
      "subtotal_amount",
      "supply_amount",
      "tax_amount",
      "total_amount",
      "expected_earning",
      "consortium_payment",
      "margin_amount",
      "margin_rate",
      "include_stamp",
      "memo",
      "items_json",
      "budgets_json",
      "drive_pdf_file_id",
      "drive_pdf_name",
      "drive_xlsx_file_id",
      "drive_xlsx_name",
      "source_file_id",
      "source_file_name",
      "source_file_type",
      "drive_sync_status",
      "drive_sync_error",
      "drive_sync_token",
      "deleted_at",
      "deleted_by",
      "deleted_by_name",
      "created_by",
      "created_by_name",
      "updated_by",
      "updated_by_name",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "organization_schedules",
    columns: [
      "id",
      "organization",
      "business_round",
      "label",
      "scheduled_date",
      "start_time",
      "end_time",
      "category",
      "stage",
      "end_date",
      "vendor_name",
      "content",
      "details",
      "completed",
      "source_activity_id",
      "complex_delivery_id",
      "assignee_member_id",
      "assignee_name",
      "google_event_id",
      "google_event_etag",
      "google_origin",
      "sync_status",
      "sync_operation",
      "sync_error",
      "sync_attempts",
      "last_synced_at",
      "google_updated_at",
      "deleted_at",
      "created_by",
      "created_by_name",
      "updated_by",
      "updated_by_name",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "construction_schedule_projects",
    columns: [
      "id",
      "organization",
      "business_round",
      "work_summary",
      "work_summary_mode",
      "manual_sort_order",
      "completed",
      "hidden_at",
      "created_by",
      "created_by_name",
      "updated_by",
      "updated_by_name",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "complex_projects",
    columns: [
      "id", "organization", "business_round", "name", "status",
      "total_budget", "source_type", "source_award_status", "manager_member_id", "manager_name", "notes", "active",
      "created_by", "created_by_name", "updated_by", "updated_by_name",
      "created_at", "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "complex_project_budget_links",
    columns: [
      "id", "complex_project_id", "equipment_project_id",
      "allocated_amount", "sort_order", "created_at", "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "complex_project_zones",
    columns: [
      "id", "complex_project_id", "building", "floor", "room", "name",
      "notes", "sort_order", "created_at", "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "complex_project_item_details",
    columns: [
      "equipment_item_id", "complex_project_id", "zone_id", "item_category",
      "procurement_method", "procurement_identifier", "delivery_location",
      "selection_round", "selection_status", "change_reason",
      "electrical_requirements", "network_requirements",
      "protection_vendor_name", "protection_state", "protection_expires_at",
      "updated_by", "updated_by_name", "created_at", "updated_at",
    ],
    orderBy: "equipment_item_id",
  },
  {
    name: "complex_project_deliveries",
    columns: [
      "id", "complex_project_id", "equipment_item_id", "schedule_id", "kind",
      "planned_qty", "completed_qty", "start_date", "end_date", "vendor_name",
      "location", "status", "notes", "created_by", "created_by_name",
      "updated_by", "updated_by_name", "created_at", "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "complex_project_events",
    columns: [
      "id", "complex_project_id", "action", "detail_json", "changed_by",
      "changed_by_name", "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "inventory_transactions",
    columns: [
      "id",
      "product_id",
      "transaction_type",
      "quantity_delta",
      "resulting_stock",
      "reference",
      "note",
      "transaction_date",
      "created_by",
      "created_by_name",
      "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "equipment_projects",
    columns: [
      "id",
      "sync_id",
      "activity_id",
      "organization",
      "business_round",
      "name",
      "status",
      "budget_type",
      "budget_original_name",
      "budget_group_id",
      "budget_match_status",
      "budget_match_method",
      "budget_request_id",
      "budget_kind",
      "budget_amount",
      "budget_amount_source",
      "notes",
      "construction_amount",
      "actual_construction_cost",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "equipment_items",
    columns: [
      "id",
      "sync_id",
      "project_id",
      "product_name",
      "specification",
      "proposed_qty",
      "awarded_qty",
      "installed_qty",
      "unit",
      "status",
      "notes",
      "catalog_item_id",
      "catalog_unit_price",
      "price_status",
      "catalog_note",
      "execution_type",
      "commission_input_type",
      "commission_rate",
      "supply_type",
      "margin_rate",
      "procurement_fee_rate",
      "consortium_commission_rate",
      "consortium_payment_amount",
      "supplier_vendor_id",
      "supplier_vendor_name",
      "protection_status",
      "protection_completed_at",
      "created_by",
      "updated_by",
      "sort_order",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "joint_projects",
    columns: [
      "id",
      "name",
      "sponsor_organization",
      "campaign_id",
      "budget_group_id",
      "budget_type",
      "project_year",
      "joint_round",
      "notes",
      "status",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "joint_project_members",
    columns: [
      "id",
      "project_id",
      "organization",
      "institution_key",
      "business_round",
      "role",
      "activity_id",
      "campaign_target_id",
      "budget_amount",
      "created_at",
      "updated_at",
    ],
    orderBy: "project_id, id",
  },
  {
    name: "joint_project_events",
    columns: [
      "id",
      "project_id",
      "action",
      "detail_json",
      "changed_by",
      "changed_by_name",
      "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "accounting_settlements",
    columns: [
      "id",
      "activity_id",
      "confirmed_contract_amount",
      "deposit_amount",
      "interim_amount",
      "balance_amount",
      "paid_amount",
      "actual_cost",
      "confirmed_commission",
      "confirmed_margin",
      "manufacturer_commission_expected",
      "manufacturer_commission_received",
      "manufacturer_commission_received_date",
      "consortium_payment_expected",
      "consortium_payment_paid",
      "consortium_payment_date",
      "other_cost",
      "commission_receivable",
      "consortium_payable",
      "net_revenue",
      "recognized_date",
      "invoice_status",
      "invoice_date",
      "settlement_status",
      "accounting_note",
      "confirmed",
      "updated_by",
      "updated_by_name",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "accounting_settlement_history",
    columns: [
      "id",
      "settlement_id",
      "activity_id",
      "snapshot_json",
      "changed_fields_json",
      "changed_by",
      "changed_by_name",
      "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "accounting_commission_entries",
    columns: [
      "id",
      "activity_id",
      "manufacturer_key",
      "manufacturer_name",
      "commission_sales_amount",
      "revenue_recognition_date",
      "invoice_status",
      "invoice_date",
      "commission_collected_amount",
      "collection_date",
      "direct_cost",
      "consortium_settlement_confirmed",
      "consortium_paid_amount",
      "consortium_paid_date",
      "receivable_balance",
      "consortium_payable",
      "contribution_margin",
      "accounting_status",
      "voucher_note",
      "confirmed",
      "workflow_excluded",
      "workflow_excluded_at",
      "workflow_excluded_by",
      "workflow_excluded_by_name",
      "legacy_source_settlement_id",
      "updated_by",
      "updated_by_name",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "accounting_commission_entry_history",
    columns: [
      "id",
      "entry_id",
      "activity_id",
      "snapshot_json",
      "changed_fields_json",
      "changed_by",
      "changed_by_name",
      "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "accounting_collection_receipts",
    columns: [
      "id",
      "entry_id",
      "activity_id",
      "amount",
      "collection_date",
      "note",
      "legacy_source_entry_id",
      "created_by",
      "created_by_name",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "member_rejections",
    columns: ["email", "rejected_by", "rejected_at"],
    orderBy: "rejected_at, email",
  },
  {
    name: "member_account_archives",
    columns: [
      "id",
      "original_member_id",
      "member_json",
      "archived_by",
      "archived_at",
    ],
    orderBy: "id",
  },
  {
    name: "holdem_weekly_scores",
    columns: ["member_id", "week_start", "best_chips", "games_played", "wins", "updated_at"],
    orderBy: "week_start, member_id",
  },
] as const satisfies readonly BackupTableDefinition[];

export type BackupTableName = (typeof BACKUP_TABLES)[number]["name"];

export type FullBackup = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  createdAt: string;
  source: {
    application: "WHIZZUP Sales Hub";
    project: "whizzup-sales-hub";
  };
  security: {
    includesBusinessData: true;
    excludes: string[];
  };
  counts: Record<BackupTableName, number>;
  checksum: string;
  data: Record<BackupTableName, BackupRow[]>;
};

export type BackupInspection = {
  valid: true;
  formatVersion: number;
  schemaVersion: string;
  createdAt: string;
  checksum: string;
  totalRows: number;
  counts: Record<BackupTableName, number>;
  excluded: string[];
  compatibilityNotices: string[];
};

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}

async function ensureBackupReady() {
  if (isPostgresDatabase()) {
    const d1 = getD1();
    await d1.prepare("SELECT 1").run();
    return d1;
  }
  await ensureCollaborationReady();
  await ensureRecordsReady();
  await ensureMapReady();
  await ensureCampaignsReady();
  await ensureEquipmentReady();
  await ensureAiRecommendationsReady();
  await ensureManagerAlertsReady();
  await ensureActivityReviewsReady();
  await ensureActivityAssignmentHistoryReady();
  await ensureActivityChangeLedgerReady();
  await ensureAccountingReady();
  await ensureProductVendorLinksReady();
  await ensureBudgetNamesReady();
  await ensureDataControlReady();
  await ensureAwardVendorsReady();
  await ensureQuotationDocumentsReady();
  await ensureSchoolDirectoryReady();
  await ensureJointProjectsReady();
  await ensureInventoryReady();
  await ensureOrganizationSchedulesReady();
  await ensureAuthoredQuotationsReady();
  await ensureComplexProjectsReady();
  await ensureResourceLibraryReady();
  await ensureYouTubeResourceLibraryReady();
  await ensureProductComparisonDocumentsReady();
  const d1 = getD1();
  await ensureInstitutionDecisionsReady(d1);
  await d1.prepare(`CREATE TABLE IF NOT EXISTS holdem_weekly_scores (
    member_id INTEGER NOT NULL, week_start TEXT NOT NULL,
    best_chips INTEGER NOT NULL DEFAULT 1000, games_played INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (member_id, week_start)
  )`).run();
  return d1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function checksumSource(backup: Omit<FullBackup, "checksum">) {
  return {
    format: backup.format,
    formatVersion: backup.formatVersion,
    schemaVersion: backup.schemaVersion,
    createdAt: backup.createdAt,
    source: backup.source,
    security: backup.security,
    counts: backup.counts,
    data: backup.data,
  };
}

async function checksumBackup(backup: Omit<FullBackup, "checksum">) {
  return sha256Hex(canonicalJson(checksumSource(backup)));
}

function replicaChecksumData(data: FullBackup["data"]) {
  return {
    ...data,
    members: data.members.map(
      ({
        last_seen_at: _lastSeenAt,
        current_view: _currentView,
        ...member
      }) => {
        let permissions = member.permissions;
        if (typeof permissions === "string") {
          try {
            permissions = JSON.parse(permissions);
          } catch {
            // Malformed permissions are reported by validation. Keep the source
            // value here so the replica checksum remains deterministic.
          }
        }
        return { ...member, permissions };
      },
    ),
  };
}

export async function replicaContentChecksum(
  backup: Pick<
    FullBackup,
    "formatVersion" | "schemaVersion" | "counts" | "data"
  >,
) {
  return sha256Hex(
    canonicalJson({
      formatVersion: backup.formatVersion,
      schemaVersion: backup.schemaVersion,
      counts: backup.counts,
      data: replicaChecksumData(backup.data),
    }),
  );
}

function asInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new BackupValidationError(`${label} 값이 올바르지 않습니다.`);
  }
  return number;
}

function nullableInteger(value: unknown, label: string) {
  if (value === null || value === "") return null;
  return asInteger(value, label);
}

function normalizeEquipmentProjectRows(
  rows: unknown[],
  fallbackCreatedBy: number,
  validMemberIds: Set<number>,
) {
  const occupiedNames = new Set<string>();
  rows.forEach((row) => {
    if (!isPlainObject(row)) return;
    const organization = String(row.organization ?? "").trim();
    const name = String(row.name ?? "").trim();
    if (organization && name) {
      occupiedNames.add(`${organization.toLowerCase()}|${name.toLowerCase()}`);
    }
  });

  return rows.map((row, index) => {
    if (!isPlainObject(row)) return row;
    const organization = String(row.organization ?? "").trim();
    const originalName = String(row.name ?? "").trim();
    const inferredName =
      originalName ||
      String(row.budget_type ?? "").trim() ||
      String(row.budget_original_name ?? "").trim() ||
      "미분류 사업";
    let name = inferredName;
    let key = `${organization.toLowerCase()}|${name.toLowerCase()}`;
    if (!originalName && occupiedNames.has(key)) {
      const rowLabel = String(row.id ?? index + 1).trim() || String(index + 1);
      name = `${inferredName} (복원 ${rowLabel})`;
      key = `${organization.toLowerCase()}|${name.toLowerCase()}`;
    }
    occupiedNames.add(key);
    const sourceCreatedBy = Number(row.created_by);
    const createdBy =
      Number.isSafeInteger(sourceCreatedBy) &&
      sourceCreatedBy > 0 &&
      validMemberIds.has(sourceCreatedBy)
        ? sourceCreatedBy
        : fallbackCreatedBy;

    return {
      ...row,
      name,
      created_by: createdBy,
      activity_id: "activity_id" in row ? row.activity_id : null,
      business_round: "business_round" in row ? row.business_round : 1,
      construction_amount:
        "construction_amount" in row ? row.construction_amount : null,
      actual_construction_cost:
        "actual_construction_cost" in row
          ? row.actual_construction_cost
          : null,
      budget_original_name:
        "budget_original_name" in row
          ? row.budget_original_name
          : row.budget_type ?? "",
      budget_group_id:
        "budget_group_id" in row ? row.budget_group_id : null,
      budget_match_status:
        "budget_match_status" in row
          ? row.budget_match_status
          : "unclassified",
      budget_match_method:
        "budget_match_method" in row ? row.budget_match_method : "legacy",
      budget_request_id:
        "budget_request_id" in row ? row.budget_request_id : null,
      budget_kind:
        "budget_kind" in row ? row.budget_kind : "unclassified",
    };
  });
}

function activityBusinessKey(row: BackupRow) {
  const organization = String(row.organization ?? "").trim().toLowerCase();
  const businessRound = Number(row.business_round ?? 1) || 1;
  return `${organization}|${businessRound}`;
}

function activityBudgetNames(row: BackupRow) {
  return new Set(
    [
      row.budget_type,
      row.budget_original_name,
      row.name,
    ]
      .map((value) =>
        String(value ?? "")
          .replace(/\s+/g, "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
}

function repairBrokenActivityReferences(
  data: Record<BackupTableName, BackupRow[]>,
) {
  const activities = data.activities;
  const activityIds = new Set(activities.map((row) => String(row.id)));
  const activitiesByBusiness = new Map<string, BackupRow[]>();
  activities.forEach((row) => {
    const key = activityBusinessKey(row);
    const candidates = activitiesByBusiness.get(key) ?? [];
    candidates.push(row);
    activitiesByBusiness.set(key, candidates);
  });

  let reconnectedProjects = 0;
  let detachedProjects = 0;
  data.equipment_projects = data.equipment_projects.map((project) => {
    const activityId = project.activity_id;
    if (
      activityId === null ||
      activityId === "" ||
      activityIds.has(String(activityId))
    ) {
      return project;
    }
    const projectBudgetNames = activityBudgetNames(project);
    const candidates = [...(activitiesByBusiness.get(activityBusinessKey(project)) ?? [])]
      .sort((left, right) => {
        const score = (activity: BackupRow) => {
          const activityNames = activityBudgetNames(activity);
          const budgetMatches = [...projectBudgetNames].some((name) =>
            activityNames.has(name),
          );
          const whizzupAward =
            String(activity.award_status ?? "").trim() === "위즈업 수주";
          const completedMatch =
            String(project.status ?? "").includes("완료") &&
            String(activity.award_stage ?? "").includes("완료");
          return (
            (whizzupAward ? 100 : 0) +
            (budgetMatches ? 20 : 0) +
            (completedMatch ? 10 : 0)
          );
        };
        const scoreDifference = score(right) - score(left);
        if (scoreDifference) return scoreDifference;
        const dateDifference =
          Date.parse(String(right.activity_date ?? "")) -
          Date.parse(String(left.activity_date ?? ""));
        if (Number.isFinite(dateDifference) && dateDifference) {
          return dateDifference;
        }
        return Number(right.id ?? 0) - Number(left.id ?? 0);
      });
    if (candidates.length) {
      reconnectedProjects += 1;
      return { ...project, activity_id: candidates[0].id };
    }
    detachedProjects += 1;
    return { ...project, activity_id: null };
  });

  let reconnectedCampaignTargets = 0;
  let detachedCampaignTargets = 0;
  data.sales_campaign_targets = data.sales_campaign_targets.map((target) => {
    const activityId = target.activity_id;
    if (
      activityId === null ||
      activityId === "" ||
      activityIds.has(String(activityId))
    ) {
      return target;
    }
    const candidates = [
      ...(activitiesByBusiness.get(activityBusinessKey(target)) ?? []),
    ].sort((left, right) => Number(right.id ?? 0) - Number(left.id ?? 0));
    if (candidates.length) {
      reconnectedCampaignTargets += 1;
      return { ...target, activity_id: candidates[0].id };
    }
    detachedCampaignTargets += 1;
    return { ...target, activity_id: null };
  });

  let reconnectedJointMembers = 0;
  let detachedJointMembers = 0;
  let detachedJointCampaignTargets = 0;
  const campaignTargetIds = new Set(
    data.sales_campaign_targets.map((row) => String(row.id)),
  );
  data.joint_project_members = data.joint_project_members.map((member) => {
    const campaignTargetId = member.campaign_target_id;
    let normalizedMember = member;
    if (
      campaignTargetId !== null &&
      campaignTargetId !== "" &&
      !campaignTargetIds.has(String(campaignTargetId))
    ) {
      detachedJointCampaignTargets += 1;
      normalizedMember = { ...normalizedMember, campaign_target_id: null };
    }
    const activityId = member.activity_id;
    if (
      activityId === null ||
      activityId === "" ||
      activityIds.has(String(activityId))
    ) {
      return normalizedMember;
    }
    const candidates = [
      ...(activitiesByBusiness.get(activityBusinessKey(member)) ?? []),
    ].sort((left, right) => {
      const dateDifference =
        Date.parse(String(right.activity_date ?? "")) -
        Date.parse(String(left.activity_date ?? ""));
      if (Number.isFinite(dateDifference) && dateDifference) {
        return dateDifference;
      }
      return Number(right.id ?? 0) - Number(left.id ?? 0);
    });
    if (candidates.length) {
      reconnectedJointMembers += 1;
      return { ...normalizedMember, activity_id: candidates[0].id };
    }
    detachedJointMembers += 1;
    return { ...normalizedMember, activity_id: null };
  });

  const notices: string[] = [];
  const preservedOrphanAccountingRows = [
    ...data.accounting_settlements,
    ...data.accounting_settlement_history,
    ...data.accounting_commission_entries,
    ...data.accounting_commission_entry_history,
    ...data.accounting_collection_receipts,
  ].filter((row) => !activityIds.has(String(row.activity_id))).length;
  if (reconnectedProjects) {
    notices.push(
      `삭제된 활동을 가리키던 사업 ${reconnectedProjects}건을 같은 기관·사업 차수의 현재 기록으로 다시 연결했습니다.`,
    );
  }
  if (detachedProjects) {
    notices.push(
      `연결할 현재 기록이 없는 사업 ${detachedProjects}건은 사업 정보는 보존하고 활동 연결만 해제했습니다.`,
    );
  }
  if (preservedOrphanAccountingRows) {
    notices.push(
      `삭제된 활동 ID를 가리키는 회계·수금 이력 ${preservedOrphanAccountingRows}건은 현재 DB 상태 그대로 보존합니다. 회계 테이블에는 활동 외래키 제약이 없어 동일하게 복원됩니다.`,
    );
  }
  return notices;
}

function requiredText(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new BackupValidationError(`${label} 값이 비어 있습니다.`);
  }
  return text;
}

function assertUnique(
  rows: BackupRow[],
  key: (row: BackupRow) => string,
  label: string,
) {
  const values = new Set<string>();
  rows.forEach((row) => {
    const value = key(row);
    if (values.has(value)) {
      throw new BackupValidationError(`${label} 중복 값이 있습니다: ${value}`);
    }
    values.add(value);
  });
}

function rowSet(rows: BackupRow[], column: string, label: string) {
  return new Set(
    rows.map((row) => String(asInteger(row[column], `${label}.${column}`))),
  );
}

function assertReference(
  value: unknown,
  validValues: Set<string>,
  label: string,
  nullable = false,
) {
  if (nullable && (value === null || value === "")) return;
  const normalized = String(asInteger(value, label));
  if (!validValues.has(normalized)) {
    throw new BackupValidationError(`${label} 연결 정보가 없습니다.`);
  }
}

function validateRows(
  data: Record<BackupTableName, BackupRow[]>,
  currentAdmin?: Pick<Member, "id" | "email">,
) {
  const totalRows = BACKUP_TABLES.reduce(
    (sum, table) => sum + data[table.name].length,
    0,
  );
  if (totalRows > BACKUP_MAX_ROWS) {
    throw new BackupValidationError(
      `백업 데이터가 ${BACKUP_MAX_ROWS.toLocaleString("ko-KR")}행을 넘어 복원할 수 없습니다.`,
    );
  }

  BACKUP_TABLES.forEach((table) => {
    const allowedColumns = new Set<string>(table.columns);
    data[table.name].forEach((row, index) => {
      if (!isPlainObject(row)) {
        throw new BackupValidationError(
          `${table.name} ${index + 1}행 형식이 올바르지 않습니다.`,
        );
      }
      const unknownColumn = Object.keys(row).find(
        (column) => !allowedColumns.has(column),
      );
      if (unknownColumn) {
        throw new BackupValidationError(
          `${table.name}에 알 수 없는 항목이 있습니다: ${unknownColumn}`,
        );
      }
      const missingColumn = table.columns.find(
        (column) => !(column in row),
      );
      if (missingColumn) {
        throw new BackupValidationError(
          `${table.name}에 필요한 항목이 없습니다: ${missingColumn}`,
        );
      }
      Object.entries(row).forEach(([column, value]) => {
        const isMemberPermissions =
          table.name === "members" &&
          column === "permissions" &&
          Array.isArray(value) &&
          value.every((permission) => typeof permission === "string");
        if (
          !isMemberPermissions &&
          value !== null &&
          typeof value !== "string" &&
          typeof value !== "number"
        ) {
          throw new BackupValidationError(
            `${table.name}.${column} 값 형식이 올바르지 않습니다.`,
          );
        }
      });
    });
  });

  const members = data.members;
  const activities = data.activities;
  const campaigns = data.sales_campaigns;
  const projects = data.equipment_projects;
  const vendors = data.award_vendors;
  const jointProjects = data.joint_projects;
  const inventoryProducts = data.inventory_products;

  assertUnique(members, (row) => String(asInteger(row.id, "members.id")), "구성원 ID");
  assertUnique(
    members,
    (row) => requiredText(row.email, "members.email").toLowerCase(),
    "구성원 이메일",
  );
  assertUnique(
    activities,
    (row) => String(asInteger(row.id, "activities.id")),
    "활동 ID",
  );
  assertUnique(
    data.activity_authors,
    (row) => String(asInteger(row.activity_id, "activity_authors.activity_id")),
    "활동 작성자 연결",
  );
  assertUnique(
    data.activity_assignment_history,
    (row) => String(asInteger(row.id, "activity_assignment_history.id")),
    "진행 담당자 변경 이력 ID",
  );
  assertUnique(
    data.activity_change_batches,
    (row) => requiredText(row.id, "activity_change_batches.id"),
    "일괄 변경 이력 ID",
  );
  assertUnique(
    data.activity_change_items,
    (row) => String(asInteger(row.id, "activity_change_items.id")),
    "일괄 변경 상세 이력 ID",
  );
  assertUnique(
    data.activity_change_items,
    (row) =>
      `${requiredText(row.batch_id, "activity_change_items.batch_id")}|${asInteger(
        row.activity_id,
        "activity_change_items.activity_id",
      )}`,
    "일괄 변경별 활동 연결",
  );
  assertUnique(
    data.authored_quotations,
    (row) => String(asInteger(row.id, "authored_quotations.id")),
    "작성 견적서 ID",
  );
  assertUnique(
    data.authored_quotations,
    (row) => requiredText(row.quote_number, "authored_quotations.quote_number"),
    "작성 견적서 번호",
  );
  assertUnique(
    data.manager_alert_acknowledgements,
    (row) =>
      String(asInteger(row.id, "manager_alert_acknowledgements.id")),
    "관리자 처리 알림 ID",
  );
  assertUnique(
    data.manager_alert_acknowledgements,
    (row) =>
      `${asInteger(row.member_id, "manager_alert_acknowledgements.member_id")}|${requiredText(
        row.organization,
        "manager_alert_acknowledgements.organization",
      )}`,
    "관리자 처리 알림",
  );
  assertUnique(
    data.activity_review_acknowledgements,
    (row) =>
      String(asInteger(row.id, "activity_review_acknowledgements.id")),
    "내 기록 점검 ID",
  );
  assertUnique(
    data.activity_review_acknowledgements,
    (row) =>
      `${asInteger(row.member_id, "activity_review_acknowledgements.member_id")}|${asInteger(
        row.activity_id,
        "activity_review_acknowledgements.activity_id",
      )}`,
    "구성원별 내 기록 점검",
  );
  assertUnique(
    data.app_settings,
    (row) => requiredText(row.key, "app_settings.key"),
    "설정 키",
  );
  assertUnique(
    vendors,
    (row) => String(asInteger(row.id, "award_vendors.id")),
    "협력사 ID",
  );
  assertUnique(
    vendors,
    (row) => requiredText(row.company_name, "award_vendors.company_name").toLowerCase(),
    "협력사명",
  );
  assertUnique(
    data.award_vendor_documents,
    (row) => String(asInteger(row.id, "award_vendor_documents.id")),
    "협력사 문서 ID",
  );
  assertUnique(
    data.award_vendor_documents,
    (row) => requiredText(row.object_key, "award_vendor_documents.object_key"),
    "협력사 문서 파일 키",
  );
  assertUnique(
    data.quotation_documents,
    (row) => String(asInteger(row.id, "quotation_documents.id")),
    "견적서 ID",
  );
  assertUnique(
    data.quotation_documents,
    (row) => requiredText(row.original_key, "quotation_documents.original_key"),
    "견적서 원본 파일 키",
  );
  assertUnique(
    data.resource_posts,
    (row) => String(asInteger(row.id, "resource_posts.id")),
    "자료실 게시글 ID",
  );
  assertUnique(
    data.resource_attachments,
    (row) => String(asInteger(row.id, "resource_attachments.id")),
    "자료실 첨부 ID",
  );
  assertUnique(
    data.resource_attachments,
    (row) => requiredText(row.drive_file_id, "resource_attachments.drive_file_id"),
    "자료실 Google Drive 파일 ID",
  );
  assertUnique(
    data.youtube_resource_links,
    (row) => String(asInteger(row.id, "youtube_resource_links.id")),
    "유튜브 자료 ID",
  );
  assertUnique(
    data.youtube_resource_links,
    (row) => requiredText(row.video_id, "youtube_resource_links.video_id"),
    "유튜브 영상 ID",
  );
  assertUnique(
    data.organization_school_links,
    (row) => requiredText(row.link_key, "organization_school_links.link_key"),
    "기관 학교 연결 키",
  );
  assertUnique(
    data.deletion_batches,
    (row) => requiredText(row.id, "deletion_batches.id"),
    "휴지통 묶음 ID",
  );
  assertUnique(
    data.holdem_weekly_scores,
    (row) =>
      `${asInteger(row.member_id, "holdem_weekly_scores.member_id")}|${requiredText(
        row.week_start,
        "holdem_weekly_scores.week_start",
      )}`,
    "구성원별 홀덤 주간 순위",
  );
  assertUnique(
    data.product_vendor_links,
    (row) => requiredText(row.product_id, "product_vendor_links.product_id"),
    "제품별 협력사 연결",
  );
  assertUnique(
    data.product_supply_settings,
    (row) =>
      requiredText(row.product_id, "product_supply_settings.product_id"),
    "제품별 공급 구분",
  );
  assertUnique(
    data.budget_name_requests,
    (row) => requiredText(row.id, "budget_name_requests.id"),
    "예산명 신청 ID",
  );
  assertUnique(
    data.budget_name_request_records,
    (row) => String(asInteger(row.id, "budget_name_request_records.id")),
    "예산명 신청 연결 ID",
  );
  assertUnique(
    data.budget_name_request_records,
    (row) =>
      `${requiredText(
        row.request_id,
        "budget_name_request_records.request_id",
      )}|${requiredText(
        row.entity_type,
        "budget_name_request_records.entity_type",
      )}|${asInteger(
        row.entity_id,
        "budget_name_request_records.entity_id",
      )}`,
    "예산명 신청 연결",
  );
  data.product_supply_settings.forEach((row) => {
    const supplyType = requiredText(
      row.supply_type,
      "product_supply_settings.supply_type",
    );
    if (supplyType !== "partner" && supplyType !== "direct") {
      throw new BackupValidationError(
        "product_supply_settings.supply_type 값이 올바르지 않습니다.",
      );
    }
    const marginRate =
      row.margin_rate === null || row.margin_rate === ""
        ? null
        : Number(row.margin_rate);
    if (
      marginRate !== null &&
      (!Number.isFinite(marginRate) || marginRate < 0 || marginRate > 1)
    ) {
      throw new BackupValidationError(
        "product_supply_settings.margin_rate 값이 올바르지 않습니다.",
      );
    }
    if (supplyType === "partner" && marginRate !== null) {
      throw new BackupValidationError(
        "협력사 공급 제품에는 마진율을 저장할 수 없습니다.",
      );
    }
  });
  const directProductIds = new Set(
    data.product_supply_settings
      .filter((row) => row.supply_type === "direct")
      .map((row) =>
        requiredText(row.product_id, "product_supply_settings.product_id"),
      ),
  );
  data.product_vendor_links.forEach((row) => {
    if (
      directProductIds.has(
        requiredText(row.product_id, "product_vendor_links.product_id"),
      )
    ) {
      throw new BackupValidationError(
        "위즈업 직접 공급 제품에는 협력사를 연결할 수 없습니다.",
      );
    }
  });
  assertUnique(
    data.institution_name_decisions,
    (row) => requiredText(row.pair_key, "institution_name_decisions.pair_key"),
    "기관 관계 확인",
  );
  assertUnique(
    data.organization_locations,
    (row) => requiredText(row.organization, "organization_locations.organization"),
    "기관 위치",
  );
  assertUnique(
    campaigns,
    (row) => String(asInteger(row.id, "sales_campaigns.id")),
    "영업 묶음 ID",
  );
  assertUnique(
    campaigns,
    (row) => requiredText(row.name, "sales_campaigns.name"),
    "영업 묶음명",
  );
  assertUnique(
    data.sales_campaign_targets,
    (row) => String(asInteger(row.id, "sales_campaign_targets.id")),
    "영업 대상 ID",
  );
  assertUnique(
    data.sales_campaign_targets,
    (row) =>
      `${asInteger(row.campaign_id, "sales_campaign_targets.campaign_id")}|${requiredText(
        row.organization,
        "sales_campaign_targets.organization",
      )}`,
    "영업 묶음별 기관",
  );
  assertUnique(
    jointProjects,
    (row) => String(asInteger(row.id, "joint_projects.id")),
    "공동사업 ID",
  );
  assertUnique(
    data.joint_project_members,
    (row) => String(asInteger(row.id, "joint_project_members.id")),
    "공동사업 기관 연결 ID",
  );
  assertUnique(
    data.joint_project_members,
    (row) =>
      `${asInteger(row.project_id, "joint_project_members.project_id")}|${requiredText(
        row.organization,
        "joint_project_members.organization",
      )}|${asInteger(row.business_round, "joint_project_members.business_round")}`,
    "공동사업별 기관·차수 연결",
  );
  assertUnique(
    data.joint_project_events,
    (row) => String(asInteger(row.id, "joint_project_events.id")),
    "공동사업 변경 이력 ID",
  );
  data.joint_project_members.forEach((row) => {
    const role = requiredText(row.role, "joint_project_members.role");
    if (role !== "sponsor" && role !== "site") {
      throw new BackupValidationError(
        "joint_project_members.role 값이 올바르지 않습니다.",
      );
    }
  });
  assertUnique(
    projects,
    (row) => String(asInteger(row.id, "equipment_projects.id")),
    "사업 ID",
  );
  assertUnique(
    projects,
    (row) =>
      `${requiredText(row.organization, "equipment_projects.organization")}|${asInteger(
        row.business_round,
        "equipment_projects.business_round",
      )}|${String(
        row.name ?? "",
      ).trim() || `legacy-${asInteger(row.id, "equipment_projects.id")}`}`,
    "기관·차수별 사업명",
  );
  assertUnique(
    data.equipment_items,
    (row) => String(asInteger(row.id, "equipment_items.id")),
    "품목 ID",
  );
  data.equipment_items.forEach((row) => {
    const supplyType = requiredText(
      row.supply_type,
      "equipment_items.supply_type",
    );
    if (supplyType !== "partner" && supplyType !== "direct") {
      throw new BackupValidationError(
        "equipment_items.supply_type 값이 올바르지 않습니다.",
      );
    }
    const marginRate =
      row.margin_rate === null || row.margin_rate === ""
        ? null
        : Number(row.margin_rate);
    if (
      marginRate !== null &&
      (!Number.isFinite(marginRate) || marginRate < 0 || marginRate > 1)
    ) {
      throw new BackupValidationError(
        "equipment_items.margin_rate 값이 올바르지 않습니다.",
      );
    }
    if (supplyType === "partner" && marginRate !== null) {
      throw new BackupValidationError(
        "협력사 공급 품목에는 마진율을 저장할 수 없습니다.",
      );
    }
    if (
      supplyType === "direct" &&
      (row.supplier_vendor_id !== null ||
        String(row.supplier_vendor_name ?? "").trim() !== "")
    ) {
      throw new BackupValidationError(
        "위즈업 직접 공급 품목에는 협력사를 연결할 수 없습니다.",
      );
    }
  });
  assertUnique(
    data.accounting_settlements,
    (row) => String(asInteger(row.id, "accounting_settlements.id")),
    "기존 회계 전표 ID",
  );
  assertUnique(
    data.accounting_settlements,
    (row) =>
      String(
        asInteger(row.activity_id, "accounting_settlements.activity_id"),
      ),
    "기존 수주별 회계 전표",
  );
  assertUnique(
    data.accounting_commission_entries,
    (row) =>
      String(asInteger(row.id, "accounting_commission_entries.id")),
    "수수료 전표 ID",
  );
  assertUnique(
    data.accounting_commission_entries,
    (row) =>
      `${asInteger(
        row.activity_id,
        "accounting_commission_entries.activity_id",
      )}|${requiredText(
        row.manufacturer_key,
        "accounting_commission_entries.manufacturer_key",
      )}`,
    "수주·제조사별 수수료 전표",
  );
  assertUnique(
    data.accounting_collection_receipts,
    (row) =>
      String(asInteger(row.id, "accounting_collection_receipts.id")),
    "수금 내역 ID",
  );
  assertUnique(
    inventoryProducts,
    (row) => String(asInteger(row.id, "inventory_products.id")),
    "재고 품목 ID",
  );
  assertUnique(
    inventoryProducts,
    (row) => requiredText(row.name, "inventory_products.name").toLowerCase(),
    "재고 품목명",
  );
  assertUnique(
    data.inventory_transactions,
    (row) => String(asInteger(row.id, "inventory_transactions.id")),
    "재고 변동 이력 ID",
  );

  const memberIds = rowSet(members, "id", "members");
  const activityIds = rowSet(activities, "id", "activities");
  const campaignIds = rowSet(campaigns, "id", "sales_campaigns");
  const campaignTargetIds = rowSet(
    data.sales_campaign_targets,
    "id",
    "sales_campaign_targets",
  );
  const projectIds = rowSet(projects, "id", "equipment_projects");
  const complexProjectIds = rowSet(
    data.complex_projects,
    "id",
    "complex_projects",
  );
  const complexZoneIds = rowSet(
    data.complex_project_zones,
    "id",
    "complex_project_zones",
  );
  const jointProjectIds = rowSet(jointProjects, "id", "joint_projects");
  const vendorIds = rowSet(vendors, "id", "award_vendors");
  const inventoryProductIds = rowSet(
    inventoryProducts,
    "id",
    "inventory_products",
  );
  const budgetGroupIds = rowSet(
    data.budget_name_groups,
    "id",
    "budget_name_groups",
  );
  const budgetRequestIds = new Set(
    data.budget_name_requests.map((row) =>
      requiredText(row.id, "budget_name_requests.id"),
    ),
  );
  const settlementIds = rowSet(
    data.accounting_settlements,
    "id",
    "accounting_settlements",
  );
  const commissionEntryIds = rowSet(
    data.accounting_commission_entries,
    "id",
    "accounting_commission_entries",
  );
  const collectionReceiptIds = rowSet(
    data.accounting_collection_receipts,
    "id",
    "accounting_collection_receipts",
  );
  void collectionReceiptIds;

  inventoryProducts.forEach((row) => {
    assertReference(row.created_by, memberIds, "inventory_products.created_by", true);
    assertReference(row.updated_by, memberIds, "inventory_products.updated_by", true);
  });
  data.inventory_transactions.forEach((row) => {
    assertReference(
      row.product_id,
      inventoryProductIds,
      "inventory_transactions.product_id",
    );
    assertReference(
      row.created_by,
      memberIds,
      "inventory_transactions.created_by",
      true,
    );
    const type = requiredText(
      row.transaction_type,
      "inventory_transactions.transaction_type",
    );
    if (!new Set(["in", "out", "adjust"]).has(type)) {
      throw new BackupValidationError("재고 변동 유형이 올바르지 않습니다.");
    }
  });

  members.forEach((row) => {
    const approvedBy = nullableInteger(row.approved_by, "members.approved_by");
    if (approvedBy !== null) {
      assertReference(approvedBy, memberIds, "members.approved_by");
    }
  });
  data.budget_name_requests.forEach((row) => {
    assertReference(
      row.requester_member_id,
      memberIds,
      "budget_name_requests.requester_member_id",
    );
    assertReference(
      row.resolved_group_id,
      budgetGroupIds,
      "budget_name_requests.resolved_group_id",
      true,
    );
    assertReference(
      row.decided_by,
      memberIds,
      "budget_name_requests.decided_by",
      true,
    );
  });
  data.budget_name_request_records.forEach((row) => {
    const requestId = requiredText(
      row.request_id,
      "budget_name_request_records.request_id",
    );
    if (!budgetRequestIds.has(requestId)) {
      throw new BackupValidationError(
        "budget_name_request_records.request_id 연결 정보가 없습니다.",
      );
    }
    const entityType = requiredText(
      row.entity_type,
      "budget_name_request_records.entity_type",
    );
    if (entityType === "activity") {
      assertReference(
        row.entity_id,
        activityIds,
        "budget_name_request_records.entity_id",
      );
    } else if (entityType === "equipment_project") {
      assertReference(
        row.entity_id,
        projectIds,
        "budget_name_request_records.entity_id",
      );
    } else {
      throw new BackupValidationError(
        "budget_name_request_records.entity_type 값이 올바르지 않습니다.",
      );
    }
  });
  activities.forEach((row) => {
    assertReference(
      row.budget_group_id,
      budgetGroupIds,
      "activities.budget_group_id",
      true,
    );
    const requestId = String(row.budget_request_id ?? "").trim();
    if (requestId && !budgetRequestIds.has(requestId)) {
      throw new BackupValidationError(
        "activities.budget_request_id 연결 정보가 없습니다.",
      );
    }
  });
  data.activity_authors.forEach((row) => {
    assertReference(
      row.activity_id,
      activityIds,
      "activity_authors.activity_id",
    );
    assertReference(
      row.member_id,
      memberIds,
      "activity_authors.member_id",
      true,
    );
  });
  data.manager_alert_acknowledgements.forEach((row) => {
    assertReference(
      row.member_id,
      memberIds,
      "manager_alert_acknowledgements.member_id",
    );
    requiredText(
      row.issue_signature,
      "manager_alert_acknowledgements.issue_signature",
    );
  });
  data.activity_assignment_history.forEach((row) => {
    assertReference(
      row.activity_id,
      activityIds,
      "activity_assignment_history.activity_id",
    );
    assertReference(
      row.to_member_id,
      memberIds,
      "activity_assignment_history.to_member_id",
    );
    assertReference(
      row.changed_by_member_id,
      memberIds,
      "activity_assignment_history.changed_by_member_id",
    );
    requiredText(
      row.to_manager,
      "activity_assignment_history.to_manager",
    );
    requiredText(
      row.changed_by_name,
      "activity_assignment_history.changed_by_name",
    );
  });
  const activityChangeBatchIds = new Set(
    data.activity_change_batches.map((row) =>
      requiredText(row.id, "activity_change_batches.id"),
    ),
  );
  data.activity_change_batches.forEach((row) => {
    assertReference(
      row.actor_member_id,
      memberIds,
      "activity_change_batches.actor_member_id",
    );
    assertReference(
      row.undone_by_member_id,
      memberIds,
      "activity_change_batches.undone_by_member_id",
      true,
    );
  });
  data.activity_change_items.forEach((row) => {
    const batchId = requiredText(
      row.batch_id,
      "activity_change_items.batch_id",
    );
    if (!activityChangeBatchIds.has(batchId)) {
      throw new BackupValidationError(
        "activity_change_items.batch_id 연결 정보가 없습니다.",
      );
    }
    asInteger(row.activity_id, "activity_change_items.activity_id");
    assertReference(
      row.undone_by_member_id,
      memberIds,
      "activity_change_items.undone_by_member_id",
      true,
    );
  });
  data.activity_review_acknowledgements.forEach((row) => {
    assertReference(
      row.member_id,
      memberIds,
      "activity_review_acknowledgements.member_id",
    );
    assertReference(
      row.activity_id,
      activityIds,
      "activity_review_acknowledgements.activity_id",
    );
    requiredText(
      row.issue_signature,
      "activity_review_acknowledgements.issue_signature",
    );
  });
  data.app_settings.forEach((row) =>
    assertReference(
      row.updated_by,
      memberIds,
      "app_settings.updated_by",
      true,
    ),
  );
  vendors.forEach((row) => {
    assertReference(row.created_by, memberIds, "award_vendors.created_by", true);
    assertReference(row.updated_by, memberIds, "award_vendors.updated_by", true);
  });
  jointProjects.forEach((row) => {
    assertReference(
      row.created_by,
      memberIds,
      "joint_projects.created_by",
    );
    assertReference(
      row.campaign_id,
      campaignIds,
      "joint_projects.campaign_id",
      true,
    );
    assertReference(
      row.budget_group_id,
      budgetGroupIds,
      "joint_projects.budget_group_id",
      true,
    );
  });
  data.joint_project_members.forEach((row) => {
    assertReference(
      row.project_id,
      jointProjectIds,
      "joint_project_members.project_id",
    );
    assertReference(
      row.activity_id,
      activityIds,
      "joint_project_members.activity_id",
      true,
    );
    assertReference(
      row.campaign_target_id,
      campaignTargetIds,
      "joint_project_members.campaign_target_id",
      true,
    );
  });
  data.joint_project_events.forEach((row) => {
    assertReference(
      row.project_id,
      jointProjectIds,
      "joint_project_events.project_id",
    );
    assertReference(
      row.changed_by,
      memberIds,
      "joint_project_events.changed_by",
    );
  });
  data.award_vendor_documents.forEach((row) => {
    assertReference(
      row.vendor_id,
      vendorIds,
      "award_vendor_documents.vendor_id",
    );
    assertReference(
      row.created_by,
      memberIds,
      "award_vendor_documents.created_by",
      true,
    );
  });
  data.quotation_documents.forEach((row) =>
    assertReference(
      row.created_by,
      memberIds,
      "quotation_documents.created_by",
      true,
    ),
  );
  const resourcePostIds = rowSet(data.resource_posts, "id", "resource_posts");
  data.resource_posts.forEach((row) => {
    assertReference(row.created_by, memberIds, "resource_posts.created_by", true);
    assertReference(row.archived_by, memberIds, "resource_posts.archived_by", true);
  });
  data.resource_attachments.forEach((row) => {
    assertReference(row.post_id, resourcePostIds, "resource_attachments.post_id");
    assertReference(row.created_by, memberIds, "resource_attachments.created_by", true);
  });
  data.youtube_resource_links.forEach((row) => {
    assertReference(row.created_by, memberIds, "youtube_resource_links.created_by", true);
  });
  data.authored_quotations.forEach((row) => {
    assertReference(
      row.created_by,
      memberIds,
      "authored_quotations.created_by",
    );
    assertReference(
      row.updated_by,
      memberIds,
      "authored_quotations.updated_by",
    );
  });
  data.deletion_batches.forEach((row) => {
    assertReference(
      row.deleted_by_member_id,
      memberIds,
      "deletion_batches.deleted_by_member_id",
    );
    assertReference(
      row.restored_by_member_id,
      memberIds,
      "deletion_batches.restored_by_member_id",
      true,
    );
  });
  data.holdem_weekly_scores.forEach((row) =>
    assertReference(
      row.member_id,
      memberIds,
      "holdem_weekly_scores.member_id",
    ),
  );
  data.product_vendor_links.forEach((row) => {
    assertReference(
      row.vendor_id,
      vendorIds,
      "product_vendor_links.vendor_id",
    );
    assertReference(
      row.updated_by,
      memberIds,
      "product_vendor_links.updated_by",
      true,
    );
  });
  data.organization_locations.forEach((row) => {
    assertReference(
      row.updated_by,
      memberIds,
      "organization_locations.updated_by",
      true,
    );
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new BackupValidationError(
        `${String(row.organization)}의 지도 좌표가 올바르지 않습니다.`,
      );
    }
  });
  campaigns.forEach((row) =>
    assertReference(row.created_by, memberIds, "sales_campaigns.created_by"),
  );
  data.sales_campaign_targets.forEach((row) => {
    assertReference(
      row.campaign_id,
      campaignIds,
      "sales_campaign_targets.campaign_id",
    );
    assertReference(
      row.assigned_member_id,
      memberIds,
      "sales_campaign_targets.assigned_member_id",
      true,
    );
    assertReference(
      row.activity_id,
      activityIds,
      "sales_campaign_targets.activity_id",
      true,
    );
  });
  projects.forEach((row) => {
    assertReference(row.created_by, memberIds, "equipment_projects.created_by");
    assertReference(
      row.activity_id,
      activityIds,
      "equipment_projects.activity_id",
      true,
    );
    assertReference(
      row.budget_group_id,
      budgetGroupIds,
      "equipment_projects.budget_group_id",
      true,
    );
    const requestId = String(row.budget_request_id ?? "").trim();
    if (requestId && !budgetRequestIds.has(requestId)) {
      throw new BackupValidationError(
        "equipment_projects.budget_request_id 연결 정보가 없습니다.",
      );
    }
  });
  data.equipment_items.forEach((row) =>
    assertReference(row.project_id, projectIds, "equipment_items.project_id"),
  );
  const equipmentItemIds = rowSet(
    data.equipment_items,
    "id",
    "equipment_items",
  );
  data.complex_projects.forEach((row) => {
    assertReference(row.created_by, memberIds, "complex_projects.created_by", true);
    assertReference(row.updated_by, memberIds, "complex_projects.updated_by", true);
    assertReference(row.manager_member_id, memberIds, "complex_projects.manager_member_id", true);
  });
  data.complex_project_budget_links.forEach((row) => {
    assertReference(row.complex_project_id, complexProjectIds, "complex_project_budget_links.complex_project_id");
    assertReference(row.equipment_project_id, projectIds, "complex_project_budget_links.equipment_project_id");
  });
  data.complex_project_zones.forEach((row) =>
    assertReference(row.complex_project_id, complexProjectIds, "complex_project_zones.complex_project_id"),
  );
  data.complex_project_item_details.forEach((row) => {
    assertReference(row.complex_project_id, complexProjectIds, "complex_project_item_details.complex_project_id");
    assertReference(row.equipment_item_id, equipmentItemIds, "complex_project_item_details.equipment_item_id");
    assertReference(row.zone_id, complexZoneIds, "complex_project_item_details.zone_id", true);
    assertReference(row.updated_by, memberIds, "complex_project_item_details.updated_by", true);
  });
  data.complex_project_deliveries.forEach((row) => {
    assertReference(row.complex_project_id, complexProjectIds, "complex_project_deliveries.complex_project_id");
    assertReference(row.equipment_item_id, equipmentItemIds, "complex_project_deliveries.equipment_item_id");
  });
  data.complex_project_events.forEach((row) => {
    assertReference(row.complex_project_id, complexProjectIds, "complex_project_events.complex_project_id");
    assertReference(row.changed_by, memberIds, "complex_project_events.changed_by", true);
  });
  data.accounting_settlements.forEach((row) =>
    asInteger(row.activity_id, "accounting_settlements.activity_id"),
  );
  data.accounting_settlement_history.forEach((row) => {
    assertReference(
      row.settlement_id,
      settlementIds,
      "accounting_settlement_history.settlement_id",
    );
    asInteger(row.activity_id, "accounting_settlement_history.activity_id");
  });
  data.accounting_commission_entries.forEach((row) =>
    asInteger(row.activity_id, "accounting_commission_entries.activity_id"),
  );
  data.accounting_commission_entry_history.forEach((row) => {
    assertReference(
      row.entry_id,
      commissionEntryIds,
      "accounting_commission_entry_history.entry_id",
    );
    asInteger(
      row.activity_id,
      "accounting_commission_entry_history.activity_id",
    );
  });
  data.accounting_collection_receipts.forEach((row) => {
    assertReference(
      row.entry_id,
      commissionEntryIds,
      "accounting_collection_receipts.entry_id",
    );
    asInteger(row.activity_id, "accounting_collection_receipts.activity_id");
  });

  if (currentAdmin) {
    const email = currentAdmin.email.trim().toLowerCase();
    const backupAdmin = members.find(
      (row) => String(row.email).trim().toLowerCase() === email,
    );
    if (
      !backupAdmin ||
      Number(backupAdmin.id) !== currentAdmin.id ||
      String(backupAdmin.role) !== "admin" ||
      String(backupAdmin.status) !== "approved"
    ) {
      throw new BackupValidationError(
        "현재 운영자 계정이 같은 ID의 승인된 운영자로 포함된 백업만 복원할 수 있습니다.",
      );
    }
  }
}

export async function createFullBackup(): Promise<FullBackup> {
  const d1 = await ensureBackupReady();
  const data = {} as Record<BackupTableName, BackupRow[]>;
  const counts = {} as Record<BackupTableName, number>;

  for (const table of BACKUP_TABLES) {
    const result = await d1
      .prepare(
        `SELECT ${table.columns.join(", ")} FROM ${table.name} ORDER BY ${table.orderBy}`,
      )
      .all<BackupRow>();
    data[table.name] = result.results;
    counts[table.name] = result.results.length;
  }

  const unsigned: Omit<FullBackup, "checksum"> = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    source: {
      application: "WHIZZUP Sales Hub",
      project: "whizzup-sales-hub",
    },
    security: {
      includesBusinessData: true,
      excludes: [
        "로그인 세션",
        "비밀번호·인증키·비밀번호 재설정 요청",
        "OAuth 클라이언트·인증코드·토큰·비밀키",
        "OPENAI_API_KEY 등 서버 환경 비밀값",
        "화면에서 등록한 OpenAI API 키",
        "나이스 학교정보 API 인증키",
        "다시 조회할 수 있는 공식 학교정보 임시 캐시",
        "견적서·자료실·협력사 증빙 첨부파일 원본(R2 또는 Google Drive 연결정보만 포함)",
        "재생성 가능한 YouTube·학교 디렉터리 캐시",
        "DB 마이그레이션·일회성 데이터 수리 작업 로그",
      ],
    },
    counts,
    data,
  };

  return {
    ...unsigned,
    checksum: await checksumBackup(unsigned),
  };
}

export async function validateFullBackup(
  input: unknown,
  currentAdmin?: Pick<Member, "id" | "email">,
): Promise<{ backup: FullBackup; inspection: BackupInspection }> {
  if (!isPlainObject(input)) {
    throw new BackupValidationError("전체 백업 파일 형식이 아닙니다.");
  }
  if (input.format !== BACKUP_FORMAT) {
    throw new BackupValidationError("WHIZZUP 전체 백업 파일이 아닙니다.");
  }
  if (input.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupValidationError(
      `지원하지 않는 백업 버전입니다. 현재 지원 버전은 ${BACKUP_FORMAT_VERSION}입니다.`,
    );
  }
  if (
    input.schemaVersion !== BACKUP_SCHEMA_VERSION &&
    !LEGACY_BACKUP_SCHEMA_VERSIONS.has(String(input.schemaVersion))
  ) {
    throw new BackupValidationError(
      "현재 사이트 구조와 다른 백업 파일입니다. 먼저 사이트 버전을 확인해 주세요.",
    );
  }
  if (!isPlainObject(input.data) || !isPlainObject(input.counts)) {
    throw new BackupValidationError("백업 데이터 또는 개수 정보가 없습니다.");
  }
  if (
    typeof input.createdAt !== "string" ||
    !Number.isFinite(Date.parse(input.createdAt))
  ) {
    throw new BackupValidationError("백업 생성 시간이 올바르지 않습니다.");
  }
  if (typeof input.checksum !== "string" || input.checksum.length !== 64) {
    throw new BackupValidationError("백업 무결성 코드가 없습니다.");
  }
  if (!isPlainObject(input.source) || !isPlainObject(input.security)) {
    throw new BackupValidationError("백업 설명 정보가 올바르지 않습니다.");
  }

  const originalUnsigned = {
    format: input.format,
    formatVersion: input.formatVersion,
    schemaVersion: input.schemaVersion,
    createdAt: input.createdAt,
    source: input.source,
    security: input.security,
    counts: input.counts,
    data: input.data,
  } as Omit<FullBackup, "checksum">;
  const originalChecksum = await checksumBackup(originalUnsigned);
  if (originalChecksum !== input.checksum) {
    throw new BackupValidationError(
      "백업 파일이 손상되었거나 내용이 변경되어 무결성 검사를 통과하지 못했습니다.",
    );
  }

  const data = {} as Record<BackupTableName, BackupRow[]>;
  const counts = {} as Record<BackupTableName, number>;
  const schemaVersion = String(input.schemaVersion);
  const restoresBudgetNameCatalog =
    Array.isArray(input.data.budget_name_groups) &&
    Array.isArray(input.data.budget_name_aliases);
  for (const table of BACKUP_TABLES) {
    const rows = input.data[table.name];
    if (
      (table.name === "ai_recommendations" ||
        table.name === "manager_alert_acknowledgements" ||
        table.name === "activity_review_acknowledgements" ||
        table.name === "activity_assignment_history" ||
        table.name === "activity_change_batches" ||
        table.name === "activity_change_items" ||
        table.name === "data_control_events" ||
        table.name === "budget_name_requests" ||
        table.name === "budget_name_request_records" ||
        table.name === "institution_name_decisions" ||
        table.name === "award_vendors" ||
        table.name === "product_vendor_links" ||
        table.name === "product_supply_settings" ||
        table.name === "accounting_settlements" ||
        table.name === "accounting_settlement_history" ||
        table.name === "accounting_commission_entries" ||
        table.name === "accounting_commission_entry_history" ||
        table.name === "accounting_collection_receipts" ||
        legacyBackupMayOmitTable(schemaVersion, table.name)) &&
      rows === undefined &&
      input.counts[table.name] === undefined
    ) {
      data[table.name] = [];
      counts[table.name] = 0;
      continue;
    }
    if (!Array.isArray(rows)) {
      throw new BackupValidationError(`${table.name} 데이터가 없습니다.`);
    }
    data[table.name] = (
      table.name === "members" && input.schemaVersion === "2026-07-18"
        ? rows.map((row) =>
            isPlainObject(row) && !("is_sales" in row)
              ? { ...row, is_sales: 0 }
              : row,
          )
        : table.name === "activities"
          ? rows.map((row) =>
              isPlainObject(row)
                ? {
                    ...row,
                    contact_role:
                      "contact_role" in row ? row.contact_role : "",
                    business_round:
                      "business_round" in row ? row.business_round : 1,
                    award_stage: normalizeAwardStage(
                      row.award_stage,
                      row.award_status,
                    ),
                    award_completed_date:
                      "award_completed_date" in row
                        ? row.award_completed_date
                        : normalizeAwardStage(
                              row.award_stage,
                              row.award_status,
                            ) === "납품 완료"
                          ? row.activity_date ?? ""
                          : "",
                    status_manual:
                      "status_manual" in row ? row.status_manual : 1,
                    progress_manager_locked:
                      "progress_manager_locked" in row
                        ? row.progress_manager_locked
                        : 0,
                    budget_original_name:
                      "budget_original_name" in row
                        ? row.budget_original_name
                        : row.budget_type ?? "",
                    budget_group_id:
                      "budget_group_id" in row ? row.budget_group_id : null,
                    budget_match_status:
                      "budget_match_status" in row
                        ? row.budget_match_status
                        : "unclassified",
                    budget_match_method:
                      "budget_match_method" in row
                        ? row.budget_match_method
                        : "legacy",
                    budget_request_id:
                      "budget_request_id" in row
                        ? row.budget_request_id
                        : null,
                    budget_kind:
                      "budget_kind" in row
                        ? row.budget_kind
                        : "unclassified",
                    budget_amount_mode:
                      "budget_amount_mode" in row
                        ? row.budget_amount_mode
                        : "manual",
                    budget_amount_override:
                      "budget_amount_override" in row
                        ? row.budget_amount_override
                        : "",
                    budgets_json:
                      "budgets_json" in row ? row.budgets_json : "[]",
                    contacts_json:
                      "contacts_json" in row ? row.contacts_json : "[]",
                    detail_level:
                      "detail_level" in row ? row.detail_level : "compact",
                    detail_summary:
                      "detail_summary" in row ? row.detail_summary : "",
                    detail_key_facts_json:
                      "detail_key_facts_json" in row
                        ? row.detail_key_facts_json
                        : "[]",
                    detail_sections_json:
                      "detail_sections_json" in row
                        ? row.detail_sections_json
                        : "[]",
                    raw_input:
                      "raw_input" in row ? row.raw_input : "",
                    updated_by_member_id:
                      "updated_by_member_id" in row
                        ? row.updated_by_member_id
                        : null,
                    updated_by_name:
                      "updated_by_name" in row ? row.updated_by_name : "",
                  }
                : row,
            )
          : table.name === "organization_schedules"
            ? rows.map((row) =>
                isPlainObject(row)
                  ? {
                      ...row,
                      complex_delivery_id:
                        "complex_delivery_id" in row
                          ? row.complex_delivery_id
                          : null,
                      content: "content" in row ? row.content : "",
                    }
                  : row,
              )
          : table.name === "budget_name_groups" &&
              input.schemaVersion !== BACKUP_SCHEMA_VERSION
            ? rows.map((row, index) =>
                isPlainObject(row)
                  ? {
                      ...row,
                      budget_kind:
                        "budget_kind" in row
                          ? row.budget_kind
                          : "unclassified",
                      amount_mode:
                        "amount_mode" in row ? row.amount_mode : "manual",
                      default_amount:
                        "default_amount" in row ? row.default_amount : null,
                      sort_order:
                        "sort_order" in row ? row.sort_order : index,
                      updated_by:
                        "updated_by" in row ? row.updated_by : null,
                      updated_by_name:
                        "updated_by_name" in row
                          ? row.updated_by_name
                          : row.created_by_name ?? "",
                      disabled_at:
                        "disabled_at" in row ? row.disabled_at : null,
                    }
                  : row,
              )
          : table.name === "budget_name_aliases" &&
              input.schemaVersion !== BACKUP_SCHEMA_VERSION
            ? rows.map((row) =>
                isPlainObject(row)
                  ? {
                      ...row,
                      created_by:
                        "created_by" in row ? row.created_by : null,
                      created_by_name:
                        "created_by_name" in row
                          ? row.created_by_name
                          : "",
                      disabled_at:
                        "disabled_at" in row ? row.disabled_at : null,
                    }
                  : row,
              )
          : table.name === "budget_name_events" &&
              input.schemaVersion !== BACKUP_SCHEMA_VERSION
            ? rows.map((row) =>
                isPlainObject(row)
                  ? {
                      ...row,
                      request_id:
                        "request_id" in row ? row.request_id : null,
                      batch_key:
                        "batch_key" in row ? row.batch_key : "",
                   }
                  : row,
              )
          : table.name === "sales_campaigns" &&
              input.schemaVersion !== BACKUP_SCHEMA_VERSION
            ? rows.map((row) =>
                isPlainObject(row)
                  ? {
                      ...row,
                      import_status:
                        "import_status" in row ? row.import_status : "complete",
                      expected_target_count:
                        "expected_target_count" in row
                          ? row.expected_target_count
                          : 0,
                    }
                  : row,
              )
          : table.name === "joint_projects" &&
              input.schemaVersion !== BACKUP_SCHEMA_VERSION
            ? rows.map((row) =>
                isPlainObject(row)
                  ? {
                      ...row,
                      project_year:
                        "project_year" in row
                          ? row.project_year
                          : Math.max(
                              2000,
                              Number(String(row.created_at ?? "").slice(0, 4)) ||
                                new Date().getFullYear(),
                            ),
                      joint_round:
                        "joint_round" in row ? row.joint_round : 1,
                    }
                  : row,
              )
          : table.name === "equipment_projects"
            ? normalizeEquipmentProjectRows(
                rows,
                currentAdmin?.id ??
                  Number(
                    data.members.find(
                      (member) => String(member.role) === "admin",
                    )?.id ?? data.members[0]?.id ?? 1,
                  ),
                new Set(
                  data.members
                    .map((member) => Number(member.id))
                    .filter(
                      (memberId) =>
                        Number.isSafeInteger(memberId) && memberId > 0,
                    ),
                ),
              )
          : table.name === "equipment_items" &&
              input.schemaVersion !== BACKUP_SCHEMA_VERSION
            ? rows.map((row) =>
                isPlainObject(row)
                  ? {
                      ...row,
                      catalog_item_id:
                        "catalog_item_id" in row ? row.catalog_item_id : "",
                      catalog_unit_price:
                        "catalog_unit_price" in row
                          ? row.catalog_unit_price
                          : null,
                      price_status:
                        "price_status" in row
                          ? row.price_status
                          : Number(row.catalog_unit_price ?? 0) > 0
                            ? "입력 완료"
                            : "금액 미입력",
                      catalog_note:
                        "catalog_note" in row ? row.catalog_note : "",
                      execution_type:
                        "execution_type" in row ? row.execution_type : "직영",
                      commission_input_type:
                        "commission_input_type" in row
                          ? row.commission_input_type
                          : "rate",
                      commission_rate:
                        "commission_rate" in row ? row.commission_rate : null,
                      supply_type:
                        "supply_type" in row ? row.supply_type : "partner",
                      margin_rate:
                        "margin_rate" in row ? row.margin_rate : null,
                      procurement_fee_rate:
                        "procurement_fee_rate" in row
                          ? row.procurement_fee_rate
                          : null,
                      consortium_commission_rate:
                        "consortium_commission_rate" in row
                          ? row.consortium_commission_rate
                          : null,
                      consortium_payment_amount:
                        "consortium_payment_amount" in row
                          ? row.consortium_payment_amount
                          : null,
                      supplier_vendor_id:
                        "supplier_vendor_id" in row
                          ? row.supplier_vendor_id
                          : null,
                      supplier_vendor_name:
                        "supplier_vendor_name" in row
                          ? row.supplier_vendor_name
                          : "",
                      protection_status:
                        "protection_status" in row
                          ? row.protection_status
                          : "신청 필요",
                      protection_completed_at:
                        "protection_completed_at" in row
                          ? row.protection_completed_at
                          : null,
                      created_by:
                        "created_by" in row ? row.created_by : null,
                      updated_by:
                        "updated_by" in row ? row.updated_by : null,
                    }
                  : row,
              )
          : rows
    ) as BackupRow[];
    counts[table.name] = rows.length;
    if (Number(input.counts[table.name]) !== rows.length) {
      throw new BackupValidationError(
        `${table.name}의 행 개수 정보가 일치하지 않습니다.`,
      );
    }
  }

  const repairNotices = repairBrokenActivityReferences(data);
  counts.equipment_projects = data.equipment_projects.length;
  counts.accounting_commission_entries =
    data.accounting_commission_entries.length;

  const backup = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: input.createdAt,
    source: input.source,
    security: input.security,
    counts,
    checksum: input.checksum,
    data,
  } as FullBackup;

  validateRows(data, currentAdmin);
  const totalRows = Object.values(counts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const excluded = Array.isArray(backup.security.excludes)
    ? backup.security.excludes.map(String)
    : [];
  const compatibilityNotices = [
    ...(PRE_BUDGET_NAME_SCHEMA_VERSIONS.has(schemaVersion) &&
    !restoresBudgetNameCatalog
      ? [LEGACY_BUDGET_NAME_NOTICE]
      : []),
    ...(schemaVersion !== BACKUP_SCHEMA_VERSION
      ? [LEGACY_COMPLETE_BUSINESS_NOTICE]
      : []),
    ...repairNotices,
  ];

  return {
    backup,
    inspection: {
      valid: true,
      formatVersion: backup.formatVersion,
      schemaVersion: backup.schemaVersion,
      createdAt: backup.createdAt,
      checksum: backup.checksum,
      totalRows,
      counts,
      excluded,
      compatibilityNotices,
    },
  };
}

function insertStatement(
  d1: ReturnType<typeof getD1>,
  table: (typeof BACKUP_TABLES)[number],
  row: BackupRow,
) {
  const placeholders = table.columns.map(() => "?").join(", ");
  const conflictClause =
    table.name === "budget_name_deleted_audit"
      ? " ON CONFLICT (id) DO NOTHING"
      : table.name === "budget_name_review_exclusions"
        ? ` ON CONFLICT (entity_type, entity_id) DO UPDATE SET
              original_name = excluded.original_name,
              excluded_by = excluded.excluded_by,
              excluded_by_name = excluded.excluded_by_name,
              excluded_at = excluded.excluded_at,
              restored_by = excluded.restored_by,
              restored_by_name = excluded.restored_by_name,
              restored_at = excluded.restored_at`
        : "";
  return d1
    .prepare(
      `INSERT INTO ${table.name} (${table.columns.join(", ")}) VALUES (${placeholders})${conflictClause}`,
    )
    .bind(...table.columns.map((column) => {
      if (table.name === "complex_projects" && column === "source_type") {
        return row[column] ?? "whizzup";
      }
      if (table.name === "complex_projects" && column === "source_award_status") {
        return row[column] ?? "위즈업 수주";
      }
      if (
        table.name === "resource_attachments" &&
        (column === "source_fingerprint" || column === "source_relative_path")
      ) {
        return row[column] ?? "";
      }
      return row[column] ?? null;
    }));
}

const RESTORE_INSERT_CHUNK_SIZE = 100;

function parseMemberPermissions(row: BackupRow) {
  try {
    const parsed = Array.isArray(row.permissions)
      ? row.permissions
      : (JSON.parse(String(row.permissions ?? "[]")) as unknown);
    if (
      !Array.isArray(parsed) ||
      parsed.some((permission) => typeof permission !== "string")
    ) {
      throw new Error("invalid member permissions");
    }
    return parsed;
  } catch {
    throw new BackupValidationError(
      "members.permissions 값이 권한 배열 형식이 아닙니다.",
    );
  }
  if (reconnectedCampaignTargets) {
    notices.push(
      `삭제된 활동을 가리키던 영업 지도 대상 ${reconnectedCampaignTargets}건을 같은 기관·사업 차수의 현재 기록으로 다시 연결했습니다.`,
    );
  }
  if (detachedCampaignTargets) {
    notices.push(
      `연결할 현재 기록이 없는 영업 지도 대상 ${detachedCampaignTargets}건은 대상 정보는 보존하고 활동 연결만 해제했습니다.`,
    );
  }
  if (reconnectedJointMembers) {
    notices.push(
      `삭제된 활동을 가리키던 공동사업 기관 ${reconnectedJointMembers}건을 같은 기관·사업 차수의 현재 기록으로 다시 연결했습니다.`,
    );
  }
  if (detachedJointMembers) {
    notices.push(
      `연결할 현재 기록이 없는 공동사업 기관 ${detachedJointMembers}건은 기관 정보는 보존하고 활동 연결만 해제했습니다.`,
    );
  }
  if (detachedJointCampaignTargets) {
    notices.push(
      `삭제된 영업 지도 대상을 가리키던 공동사업 기관 ${detachedJointCampaignTargets}건은 기관 정보는 보존하고 지도 대상 연결만 해제했습니다.`,
    );
  }
}

function insertStatements(
  d1: ReturnType<typeof getD1>,
  table: (typeof BACKUP_TABLES)[number],
  rows: BackupRow[],
) {
  const statements = [];
  const conflictClause =
    table.name === "budget_name_deleted_audit"
      ? " ON CONFLICT (id) DO NOTHING"
      : table.name === "budget_name_review_exclusions"
        ? ` ON CONFLICT (entity_type, entity_id) DO UPDATE SET
              original_name = excluded.original_name,
              excluded_by = excluded.excluded_by,
              excluded_by_name = excluded.excluded_by_name,
              excluded_at = excluded.excluded_at,
              restored_by = excluded.restored_by,
              restored_by_name = excluded.restored_by_name,
              restored_at = excluded.restored_at`
        : "";
  for (
    let offset = 0;
    offset < rows.length;
    offset += RESTORE_INSERT_CHUNK_SIZE
  ) {
    const chunk = rows.slice(offset, offset + RESTORE_INSERT_CHUNK_SIZE);
    const parameters: unknown[] = [];
    const values = chunk.map((row) => {
      const memberPermissions =
        table.name === "members" ? parseMemberPermissions(row) : [];
      const placeholders = table.columns.map((column) => {
        if (table.name === "members" && column === "permissions") {
          parameters.push(...memberPermissions);
          return memberPermissions.length > 0
            ? `jsonb_build_array(${memberPermissions
                .map(() => "?::text")
                .join(", ")})`
            : "'[]'::jsonb";
        }
        const restoredValue = table.name === "complex_projects" && column === "source_type"
          ? row[column] ?? "whizzup"
          : table.name === "complex_projects" && column === "source_award_status"
            ? row[column] ?? "위즈업 수주"
            : table.name === "resource_attachments" &&
                (column === "source_fingerprint" || column === "source_relative_path")
              ? row[column] ?? ""
              : row[column] ?? null;
        parameters.push(restoredValue);
        return "?";
      });
      return `(${placeholders.join(", ")})`;
    });
    statements.push(
      d1
        .prepare(
          `INSERT INTO ${table.name} (${table.columns.join(", ")}) VALUES ${values.join(", ")}${conflictClause}`,
        )
        .bind(...parameters),
    );
  }
  return statements;
}

type RestorePresence = {
  restoresLegacySchema: boolean;
  restoresAwardVendors: boolean;
  restoresAwardVendorDocuments: boolean;
  restoresQuotationDocuments: boolean;
  restoresAuthoredQuotations: boolean;
  restoresOrganizationSchoolLinks: boolean;
  restoresDeletionBatches: boolean;
  restoresHoldemScores: boolean;
  restoresProductVendorLinks: boolean;
  restoresProductSupplySettings: boolean;
  restoresBudgetNameCatalog: boolean;
  restoresJointProjects: boolean;
  restoresInventory: boolean;
  restoresComplexProjects: boolean;
  restoresDriveLibrary: boolean;
  restoresDurableAuthHistory: boolean;
};

function restorePresenceFromInput(input: unknown): RestorePresence {
  const rawData =
    isPlainObject(input) && isPlainObject(input.data) ? input.data : null;
  return {
    restoresLegacySchema:
      isPlainObject(input) && input.schemaVersion !== BACKUP_SCHEMA_VERSION,
    restoresAwardVendors: Array.isArray(rawData?.award_vendors),
    restoresAwardVendorDocuments: Array.isArray(
      rawData?.award_vendor_documents,
    ),
    restoresQuotationDocuments: Array.isArray(rawData?.quotation_documents),
    restoresAuthoredQuotations: Array.isArray(rawData?.authored_quotations),
    restoresOrganizationSchoolLinks: Array.isArray(
      rawData?.organization_school_links,
    ),
    restoresDeletionBatches: Array.isArray(rawData?.deletion_batches),
    restoresHoldemScores: Array.isArray(rawData?.holdem_weekly_scores),
    restoresProductVendorLinks: Array.isArray(rawData?.product_vendor_links),
    restoresProductSupplySettings: Array.isArray(
      rawData?.product_supply_settings,
    ),
    restoresBudgetNameCatalog:
      Array.isArray(rawData?.budget_name_groups) &&
      Array.isArray(rawData?.budget_name_aliases),
    restoresJointProjects:
      Array.isArray(rawData?.joint_projects) &&
      Array.isArray(rawData?.joint_project_members) &&
      Array.isArray(rawData?.joint_project_events),
    restoresInventory:
      Array.isArray(rawData?.inventory_products) &&
      Array.isArray(rawData?.inventory_transactions),
    restoresComplexProjects: [...COMPLEX_PROJECT_BACKUP_TABLES].every((tableName) =>
      Array.isArray(rawData?.[tableName]),
    ),
    restoresDriveLibrary: [...DRIVE_LIBRARY_BACKUP_TABLES].every((tableName) =>
      Array.isArray(rawData?.[tableName]),
    ),
    restoresDurableAuthHistory: [...DURABLE_AUTH_HISTORY_BACKUP_TABLES].every(
      (tableName) => Array.isArray(rawData?.[tableName]),
    ),
  };
}

async function replaceDatabaseFromBackup(
  backup: FullBackup,
  presence: RestorePresence = {
    restoresLegacySchema: backup.schemaVersion !== BACKUP_SCHEMA_VERSION,
    restoresAwardVendors: true,
    restoresAwardVendorDocuments: true,
    restoresQuotationDocuments: true,
    restoresAuthoredQuotations: true,
    restoresOrganizationSchoolLinks: true,
    restoresDeletionBatches: true,
    restoresHoldemScores: true,
    restoresProductVendorLinks: true,
    restoresProductSupplySettings: true,
    restoresBudgetNameCatalog: true,
    restoresJointProjects: true,
    restoresInventory: true,
    restoresComplexProjects: true,
    restoresDriveLibrary: true,
    restoresDurableAuthHistory: true,
  },
) {
  const {
    restoresLegacySchema,
    restoresAwardVendors,
    restoresAwardVendorDocuments,
    restoresQuotationDocuments,
    restoresAuthoredQuotations,
    restoresOrganizationSchoolLinks,
    restoresDeletionBatches,
    restoresHoldemScores,
    restoresProductVendorLinks,
    restoresProductSupplySettings,
    restoresBudgetNameCatalog,
    restoresJointProjects,
    restoresInventory,
    restoresComplexProjects,
    restoresDriveLibrary,
    restoresDurableAuthHistory,
  } = presence;
  const d1 = await ensureBackupReady();
  const statements = [
    ...(restoresDriveLibrary
      ? [
          d1.prepare("DELETE FROM product_comparison_documents"),
          d1.prepare("DELETE FROM youtube_resource_links"),
          d1.prepare("DELETE FROM resource_attachments"),
          d1.prepare("DELETE FROM resource_posts"),
        ]
      : []),
    ...(restoresInventory
      ? [
          d1.prepare("DELETE FROM inventory_transactions"),
          d1.prepare("DELETE FROM inventory_products"),
        ]
      : []),
    ...(restoresJointProjects
      ? [
          d1.prepare("DELETE FROM joint_project_events"),
          d1.prepare("DELETE FROM joint_project_members"),
          d1.prepare("DELETE FROM joint_projects"),
        ]
      : []),
    ...(restoresComplexProjects
      ? [
          d1.prepare("DELETE FROM complex_project_events"),
          d1.prepare("DELETE FROM complex_project_deliveries"),
          d1.prepare("DELETE FROM complex_project_item_details"),
          d1.prepare("DELETE FROM complex_project_zones"),
          d1.prepare("DELETE FROM complex_project_budget_links"),
          d1.prepare("DELETE FROM complex_projects"),
        ]
      : []),
    ...(restoresAwardVendorDocuments
      ? [d1.prepare("DELETE FROM award_vendor_documents")]
      : []),
    ...(restoresQuotationDocuments
      ? [d1.prepare("DELETE FROM quotation_documents")]
      : []),
    ...(restoresAuthoredQuotations
      ? [d1.prepare("DELETE FROM authored_quotations")]
      : []),
    ...(restoresOrganizationSchoolLinks
      ? [d1.prepare("DELETE FROM organization_school_links")]
      : []),
    ...(restoresDeletionBatches
      ? [d1.prepare("DELETE FROM deletion_batches")]
      : []),
    ...(restoresHoldemScores
      ? [d1.prepare("DELETE FROM holdem_weekly_scores")]
      : []),
    d1.prepare("DELETE FROM activity_change_items"),
    d1.prepare("DELETE FROM activity_change_batches"),
    d1.prepare("DELETE FROM data_control_events"),
    d1.prepare("DELETE FROM budget_name_request_records"),
    d1.prepare("DELETE FROM budget_name_requests"),
    d1.prepare("DELETE FROM budget_name_events"),
    d1.prepare("DELETE FROM budget_name_members"),
    ...(restoresBudgetNameCatalog
      ? [
          d1.prepare("DELETE FROM budget_name_aliases"),
          d1.prepare("DELETE FROM budget_name_groups"),
        ]
      : []),
    d1.prepare("DELETE FROM accounting_collection_receipts"),
    d1.prepare("DELETE FROM accounting_commission_entry_history"),
    d1.prepare("DELETE FROM accounting_settlement_history"),
    d1.prepare("DELETE FROM accounting_commission_entries"),
    d1.prepare("DELETE FROM accounting_settlements"),
    d1.prepare("DELETE FROM activity_authors"),
    d1.prepare("DELETE FROM activity_assignment_history"),
    d1.prepare("DELETE FROM activity_review_acknowledgements"),
    d1.prepare("DELETE FROM manager_alert_acknowledgements"),
    d1.prepare("DELETE FROM ai_recommendations"),
    ...(restoresProductVendorLinks
      ? [d1.prepare("DELETE FROM product_vendor_links")]
      : []),
    d1.prepare("DELETE FROM product_supply_settings"),
    d1.prepare("DELETE FROM equipment_items"),
    ...(restoresAwardVendors ? [d1.prepare("DELETE FROM award_vendors")] : []),
    d1.prepare("DELETE FROM sales_campaign_targets"),
    d1.prepare("DELETE FROM organization_locations"),
    d1.prepare("DELETE FROM equipment_projects"),
    d1.prepare("DELETE FROM sales_campaigns"),
    d1.prepare("DELETE FROM app_settings"),
    d1.prepare("DELETE FROM institution_name_decisions"),
    d1.prepare("DELETE FROM construction_schedule_projects"),
    d1.prepare("DELETE FROM organization_schedules"),
    d1.prepare("DELETE FROM activities"),
    ...(restoresDurableAuthHistory
      ? [
          d1.prepare("DELETE FROM member_rejections"),
          d1.prepare("DELETE FROM member_account_archives"),
        ]
      : []),
    d1.prepare("DELETE FROM members"),
  ];

  const insertOrder: BackupTableName[] = [
    "members",
    "member_rejections",
    "member_account_archives",
    "resource_posts",
    "resource_attachments",
    "youtube_resource_links",
    "product_comparison_documents",
    "inventory_products",
    "inventory_transactions",
    "award_vendors",
    "award_vendor_documents",
    "product_supply_settings",
    "product_vendor_links",
    "budget_name_groups",
    "budget_name_aliases",
    "budget_name_requests",
    "manager_alert_acknowledgements",
    "activities",
    "ai_recommendations",
    "organization_schedules",
    "construction_schedule_projects",
    "complex_projects",
    "activity_change_batches",
    "activity_change_items",
    "data_control_events",
    "accounting_settlements",
    "accounting_commission_entries",
    "accounting_collection_receipts",
    "accounting_settlement_history",
    "accounting_commission_entry_history",
    "activity_assignment_history",
    "activity_review_acknowledgements",
    "app_settings",
    "institution_name_decisions",
    "organization_school_links",
    "organization_locations",
    "quotation_documents",
    "authored_quotations",
    "sales_campaigns",
    "joint_projects",
    "joint_project_members",
    "joint_project_events",
    "equipment_projects",
    "complex_project_budget_links",
    "activity_authors",
    "sales_campaign_targets",
    "joint_projects",
    "joint_project_members",
    "joint_project_events",
    "equipment_items",
    "complex_project_zones",
    "complex_project_item_details",
    "complex_project_deliveries",
    "complex_project_events",
    "budget_name_request_records",
    "budget_name_members",
    "budget_name_events",
    "budget_name_deleted_audit",
    "budget_name_review_exclusions",
    "deletion_batches",
    "holdem_weekly_scores",
  ];

  insertOrder.forEach((tableName) => {
    if (
      DURABLE_AUTH_HISTORY_BACKUP_TABLES.has(tableName) &&
      !restoresDurableAuthHistory
    ) {
      return;
    }
    if (
      DRIVE_LIBRARY_BACKUP_TABLES.has(tableName) &&
      !restoresDriveLibrary
    ) {
      return;
    }
    if (
      (tableName === "inventory_products" ||
        tableName === "inventory_transactions") &&
      !restoresInventory
    ) {
      return;
    }
    if (
      (tableName === "joint_projects" ||
        tableName === "joint_project_members" ||
        tableName === "joint_project_events") &&
      !restoresJointProjects
    ) {
      return;
    }
    if (
      COMPLEX_PROJECT_BACKUP_TABLES.has(tableName) &&
      !restoresComplexProjects
    ) {
      return;
    }
    if (tableName === "award_vendors" && !restoresAwardVendors) return;
    if (
      tableName === "award_vendor_documents" &&
      !restoresAwardVendorDocuments
    ) {
      return;
    }
    if (tableName === "quotation_documents" && !restoresQuotationDocuments) {
      return;
    }
    if (tableName === "authored_quotations" && !restoresAuthoredQuotations) {
      return;
    }
    if (
      tableName === "organization_school_links" &&
      !restoresOrganizationSchoolLinks
    ) {
      return;
    }
    if (tableName === "deletion_batches" && !restoresDeletionBatches) return;
    if (tableName === "holdem_weekly_scores" && !restoresHoldemScores) return;
    if (
      (tableName === "budget_name_groups" ||
        tableName === "budget_name_aliases") &&
      !restoresBudgetNameCatalog
    ) {
      return;
    }
    if (
      tableName === "product_vendor_links" &&
      !restoresProductVendorLinks
    ) {
      return;
    }
    if (
      tableName === "product_supply_settings" &&
      !restoresProductSupplySettings
    ) {
      return;
    }
    const table = BACKUP_TABLES.find((item) => item.name === tableName);
    if (!table) return;
    statements.push(...insertStatements(d1, table, backup.data[tableName]));
  });
  if (!restoresProductSupplySettings) {
    statements.push(
      d1.prepare(
        `INSERT INTO product_supply_settings (
           product_id, supply_type, margin_rate, updated_by
         ) VALUES ('quote-62', 'direct', 0.5545454545454546, 0)`,
      ),
    );
  }
  statements.push(
    d1.prepare(
      `DELETE FROM product_vendor_links
       WHERE product_id IN (
         SELECT product_id
         FROM product_supply_settings
         WHERE supply_type = 'direct'
      )`,
    ),
  );
  if (restoresLegacySchema) {
    statements.push(
      d1.prepare(
        `UPDATE equipment_items
         SET supply_type = 'direct',
             margin_rate = (
               SELECT margin_rate
               FROM product_supply_settings
               WHERE product_id = equipment_items.catalog_item_id
             ),
             commission_rate = NULL,
             supplier_vendor_id = NULL,
             supplier_vendor_name = '',
             updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('제안 예정', '제안', '견적')
           AND COALESCE(supply_type, 'partner') = 'partner'
           AND catalog_item_id IN (
             SELECT product_id
             FROM product_supply_settings
             WHERE supply_type = 'direct'
           )`,
      ),
    );
  }

  [
    "members",
    "resource_posts",
    "resource_attachments",
    "youtube_resource_links",
    "product_comparison_documents",
    "activities",
    "award_vendors",
    "award_vendor_documents",
    "quotation_documents",
    "activity_assignment_history",
    "activity_change_items",
    "manager_alert_acknowledgements",
    "data_control_events",
    "activity_review_acknowledgements",
    "ai_recommendations",
    "budget_name_groups",
    "budget_name_aliases",
    "budget_name_members",
    "budget_name_events",
    "budget_name_deleted_audit",
    "budget_name_request_records",
    "sales_campaigns",
    "equipment_projects",
    "sales_campaign_targets",
    "equipment_items",
    "accounting_settlements",
    "accounting_settlement_history",
    "accounting_commission_entries",
    "accounting_commission_entry_history",
    "accounting_collection_receipts",
    "member_account_archives",
  ].forEach((tableName) => {
    statements.push(
      d1.prepare(
        `SELECT setval(
           pg_get_serial_sequence('public.${tableName}', 'id'),
           COALESCE((SELECT MAX(id) FROM ${tableName}), 1),
           EXISTS (SELECT 1 FROM ${tableName})
         )`,
      ),
    );
  });

  await d1.batch(statements);
}

export async function restoreFullBackup(
  input: unknown,
  currentAdmin?: Pick<Member, "id" | "email">,
) {
  const restoresLegacySchema =
    isPlainObject(input) &&
    input.schemaVersion !== BACKUP_SCHEMA_VERSION;
  const rawData =
    isPlainObject(input) && isPlainObject(input.data) ? input.data : null;
  const restoresAwardVendors = Array.isArray(rawData?.award_vendors);
  const restoresAwardVendorDocuments = Array.isArray(
    rawData?.award_vendor_documents,
  );
  const restoresQuotationDocuments = Array.isArray(
    rawData?.quotation_documents,
  );
  const restoresResourceLibrary =
    Array.isArray(rawData?.resource_posts) &&
    Array.isArray(rawData?.resource_attachments);
  const restoresYoutubeResourceLinks = Array.isArray(
    rawData?.youtube_resource_links,
  );
  const restoresAuthoredQuotations = Array.isArray(
    rawData?.authored_quotations,
  );
  const restoresOrganizationSchoolLinks = Array.isArray(
    rawData?.organization_school_links,
  );
  const restoresDeletionBatches = Array.isArray(rawData?.deletion_batches);
  const restoresHoldemScores = Array.isArray(rawData?.holdem_weekly_scores);
  const restoresDurableAuthHistory = [
    ...DURABLE_AUTH_HISTORY_BACKUP_TABLES,
  ].every((tableName) => Array.isArray(rawData?.[tableName]));
  const restoresProductVendorLinks = Array.isArray(
    rawData?.product_vendor_links,
  );
  const restoresProductSupplySettings = Array.isArray(
    rawData?.product_supply_settings,
  );
  const restoresBudgetNameCatalog =
    Array.isArray(rawData?.budget_name_groups) &&
    Array.isArray(rawData?.budget_name_aliases);
  const restoresJointProjects =
    Array.isArray(rawData?.joint_projects) &&
    Array.isArray(rawData?.joint_project_members) &&
    Array.isArray(rawData?.joint_project_events);
  const restoresInventory =
    Array.isArray(rawData?.inventory_products) &&
    Array.isArray(rawData?.inventory_transactions);
  const restoresComplexProjects =
    Array.isArray(rawData?.complex_projects) &&
    Array.isArray(rawData?.complex_project_budget_links) &&
    Array.isArray(rawData?.complex_project_zones) &&
    Array.isArray(rawData?.complex_project_item_details) &&
    Array.isArray(rawData?.complex_project_deliveries) &&
    Array.isArray(rawData?.complex_project_events);
  const { backup, inspection } = await validateFullBackup(
    input,
    currentAdmin,
  );
  const d1 = await ensureBackupReady();
  const statements = [
    ...(restoresResourceLibrary
      ? [
          d1.prepare("DELETE FROM resource_attachments"),
          d1.prepare("DELETE FROM resource_posts"),
        ]
      : []),
    ...(restoresYoutubeResourceLinks
      ? [d1.prepare("DELETE FROM youtube_resource_links")]
      : []),
    ...(restoresComplexProjects
      ? [
          d1.prepare("DELETE FROM complex_project_events"),
          d1.prepare("DELETE FROM complex_project_deliveries"),
          d1.prepare("DELETE FROM complex_project_item_details"),
          d1.prepare("DELETE FROM complex_project_zones"),
          d1.prepare("DELETE FROM complex_project_budget_links"),
          d1.prepare("DELETE FROM complex_projects"),
        ]
      : []),
    ...(restoresInventory
      ? [
          d1.prepare("DELETE FROM inventory_transactions"),
          d1.prepare("DELETE FROM inventory_products"),
        ]
      : []),
    ...(restoresJointProjects
      ? [
          d1.prepare("DELETE FROM joint_project_events"),
          d1.prepare("DELETE FROM joint_project_members"),
          d1.prepare("DELETE FROM joint_projects"),
        ]
      : []),
    ...(restoresAwardVendorDocuments
      ? [d1.prepare("DELETE FROM award_vendor_documents")]
      : []),
    ...(restoresQuotationDocuments
      ? [d1.prepare("DELETE FROM quotation_documents")]
      : []),
    ...(restoresAuthoredQuotations
      ? [d1.prepare("DELETE FROM authored_quotations")]
      : []),
    ...(restoresOrganizationSchoolLinks
      ? [d1.prepare("DELETE FROM organization_school_links")]
      : []),
    ...(restoresDeletionBatches
      ? [d1.prepare("DELETE FROM deletion_batches")]
      : []),
    ...(restoresHoldemScores
      ? [d1.prepare("DELETE FROM holdem_weekly_scores")]
      : []),
    d1.prepare("DELETE FROM activity_change_items"),
    d1.prepare("DELETE FROM activity_change_batches"),
    d1.prepare("DELETE FROM data_control_events"),
    d1.prepare("DELETE FROM budget_name_request_records"),
    d1.prepare("DELETE FROM budget_name_requests"),
    d1.prepare("DELETE FROM budget_name_events"),
    d1.prepare("DELETE FROM budget_name_members"),
    ...(restoresBudgetNameCatalog
      ? [
          d1.prepare("DELETE FROM budget_name_aliases"),
          d1.prepare("DELETE FROM budget_name_groups"),
        ]
      : []),
    d1.prepare("DELETE FROM accounting_collection_receipts"),
    d1.prepare("DELETE FROM accounting_commission_entry_history"),
    d1.prepare("DELETE FROM accounting_settlement_history"),
    d1.prepare("DELETE FROM accounting_commission_entries"),
    d1.prepare("DELETE FROM accounting_settlements"),
    d1.prepare("DELETE FROM activity_authors"),
    d1.prepare("DELETE FROM activity_assignment_history"),
    d1.prepare("DELETE FROM activity_review_acknowledgements"),
    d1.prepare("DELETE FROM manager_alert_acknowledgements"),
    d1.prepare("DELETE FROM ai_recommendations"),
    ...(restoresProductVendorLinks
      ? [d1.prepare("DELETE FROM product_vendor_links")]
      : []),
    d1.prepare("DELETE FROM product_supply_settings"),
    d1.prepare("DELETE FROM equipment_items"),
    ...(restoresAwardVendors ? [d1.prepare("DELETE FROM award_vendors")] : []),
    d1.prepare("DELETE FROM sales_campaign_targets"),
    d1.prepare("DELETE FROM organization_locations"),
    d1.prepare("DELETE FROM equipment_projects"),
    d1.prepare("DELETE FROM sales_campaigns"),
    d1.prepare("DELETE FROM app_settings"),
    d1.prepare("DELETE FROM institution_name_decisions"),
    d1.prepare("DELETE FROM construction_schedule_projects"),
    d1.prepare("DELETE FROM organization_schedules"),
    d1.prepare("DELETE FROM activities"),
    ...(restoresDurableAuthHistory
      ? [
          d1.prepare("DELETE FROM member_rejections"),
          d1.prepare("DELETE FROM member_account_archives"),
        ]
      : []),
    d1.prepare("DELETE FROM members"),
  ];

  const insertOrder: BackupTableName[] = [
    "members",
    "member_rejections",
    "member_account_archives",
    "resource_posts",
    "resource_attachments",
    "youtube_resource_links",
    "inventory_products",
    "inventory_transactions",
    "award_vendors",
    "award_vendor_documents",
    "product_supply_settings",
    "product_vendor_links",
    "budget_name_groups",
    "budget_name_aliases",
    "budget_name_requests",
    "manager_alert_acknowledgements",
    "activities",
    "organization_schedules",
    "construction_schedule_projects",
    "complex_projects",
    "activity_change_batches",
    "activity_change_items",
    "data_control_events",
    "accounting_settlements",
    "accounting_commission_entries",
    "accounting_collection_receipts",
    "accounting_settlement_history",
    "accounting_commission_entry_history",
    "activity_assignment_history",
    "activity_review_acknowledgements",
    "app_settings",
    "institution_name_decisions",
    "organization_school_links",
    "organization_locations",
    "quotation_documents",
    "authored_quotations",
    "sales_campaigns",
    "equipment_projects",
    "complex_project_budget_links",
    "activity_authors",
    "sales_campaign_targets",
    "joint_projects",
    "joint_project_members",
    "joint_project_events",
    "equipment_items",
    "complex_project_zones",
    "complex_project_item_details",
    "complex_project_deliveries",
    "complex_project_events",
    "budget_name_request_records",
    "budget_name_members",
    "budget_name_events",
    "budget_name_deleted_audit",
    "budget_name_review_exclusions",
    "deletion_batches",
    "holdem_weekly_scores",
  ];

  insertOrder.forEach((tableName) => {
    if (
      DURABLE_AUTH_HISTORY_BACKUP_TABLES.has(tableName) &&
      !restoresDurableAuthHistory
    ) {
      return;
    }
    if (
      (tableName === "resource_posts" || tableName === "resource_attachments") &&
      !restoresResourceLibrary
    ) {
      return;
    }
    if (tableName === "youtube_resource_links" && !restoresYoutubeResourceLinks) {
      return;
    }
    if (
      (tableName === "inventory_products" ||
        tableName === "inventory_transactions") &&
      !restoresInventory
    ) {
      return;
    }
    if (
      (tableName === "joint_projects" ||
        tableName === "joint_project_members" ||
        tableName === "joint_project_events") &&
      !restoresJointProjects
    ) {
      return;
    }
    if (COMPLEX_PROJECT_BACKUP_TABLES.has(tableName) && !restoresComplexProjects) {
      return;
    }
    if (tableName === "award_vendors" && !restoresAwardVendors) return;
    if (
      tableName === "award_vendor_documents" &&
      !restoresAwardVendorDocuments
    ) {
      return;
    }
    if (tableName === "quotation_documents" && !restoresQuotationDocuments) {
      return;
    }
    if (tableName === "authored_quotations" && !restoresAuthoredQuotations) {
      return;
    }
    if (
      tableName === "organization_school_links" &&
      !restoresOrganizationSchoolLinks
    ) {
      return;
    }
    if (tableName === "deletion_batches" && !restoresDeletionBatches) return;
    if (tableName === "holdem_weekly_scores" && !restoresHoldemScores) return;
    if (
      (tableName === "budget_name_groups" ||
        tableName === "budget_name_aliases") &&
      !restoresBudgetNameCatalog
    ) {
      return;
    }
    if (
      tableName === "product_vendor_links" &&
      !restoresProductVendorLinks
    ) {
      return;
    }
    if (
      tableName === "product_supply_settings" &&
      !restoresProductSupplySettings
    ) {
      return;
    }
    const table = BACKUP_TABLES.find((item) => item.name === tableName);
    if (!table) return;
    backup.data[tableName].forEach((row) => {
      statements.push(insertStatement(d1, table, row));
    });
  });
  if (!restoresProductSupplySettings) {
    statements.push(
      d1.prepare(
        `INSERT INTO product_supply_settings (
           product_id, supply_type, margin_rate, updated_by
         ) VALUES ('quote-62', 'direct', 0.5545454545454546, 0)`,
      ),
    );
  }
  statements.push(
    d1.prepare(
      `DELETE FROM product_vendor_links
       WHERE product_id IN (
         SELECT product_id
         FROM product_supply_settings
         WHERE supply_type = 'direct'
      )`,
    ),
  );
  if (restoresLegacySchema) {
    statements.push(
      d1.prepare(
        `UPDATE equipment_items
         SET supply_type = 'direct',
             margin_rate = (
               SELECT margin_rate
               FROM product_supply_settings
               WHERE product_id = equipment_items.catalog_item_id
             ),
             commission_rate = NULL,
             supplier_vendor_id = NULL,
             supplier_vendor_name = '',
             updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('제안 예정', '제안', '견적')
           AND COALESCE(supply_type, 'partner') = 'partner'
           AND catalog_item_id IN (
             SELECT product_id
             FROM product_supply_settings
             WHERE supply_type = 'direct'
           )`,
      ),
    );
  }

  await d1.batch(statements);
  return inspection;
}

export async function restoreReplicaBackup(input: unknown) {
  const { backup, inspection } = await validateFullBackup(input);
  await replaceDatabaseFromBackup(backup);
  return inspection;
}

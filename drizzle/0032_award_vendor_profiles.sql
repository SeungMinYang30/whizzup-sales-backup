CREATE TABLE IF NOT EXISTS award_vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  business_number TEXT NOT NULL DEFAULT '', representative_name TEXT NOT NULL DEFAULT '',
  business_type TEXT NOT NULL DEFAULT '', business_item TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', bank_name TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '', account_holder TEXT NOT NULL DEFAULT '', contact_name TEXT NOT NULL DEFAULT '',
  contact_title TEXT NOT NULL DEFAULT '', contact_phone TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL, updated_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS award_vendors_company_idx ON award_vendors (company_name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS award_vendor_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER NOT NULL, document_type TEXT NOT NULL,
  original_name TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, extracted_json TEXT NOT NULL DEFAULT '{}', created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS award_vendor_documents_vendor_idx ON award_vendor_documents (vendor_id, document_type, created_at);

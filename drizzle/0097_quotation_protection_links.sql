CREATE TABLE IF NOT EXISTS quotation_equipment_item_links (
  quotation_id BIGINT NOT NULL,
  quotation_item_key TEXT NOT NULL,
  equipment_item_id BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (quotation_id, quotation_item_key)
);

CREATE INDEX IF NOT EXISTS quotation_equipment_item_links_item_idx
  ON quotation_equipment_item_links (equipment_item_id);

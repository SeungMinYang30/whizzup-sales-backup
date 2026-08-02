ALTER TABLE `equipment_items` ADD `consortium_commission_rate` real;

-- The first consortium version stored the consortium rate in commission_rate.
-- Move that legacy value before commission_rate becomes the WizUp receiving rate.
UPDATE `equipment_items`
SET `consortium_commission_rate` = `commission_rate`,
    `commission_rate` = NULL
WHERE `execution_type` = '컨소'
  AND `commission_input_type` = 'rate'
  AND `commission_rate` IS NOT NULL;

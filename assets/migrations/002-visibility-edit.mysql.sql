-- Run before deploying the visibility-edit server. Do not backfill old private comments.
-- Back up first; replace wl_Comment if MYSQL_PREFIX differs. Run once only.
ALTER TABLE `wl_Comment`
  ADD COLUMN `visibility_source` ENUM('legacy','author','admin') NOT NULL DEFAULT 'legacy';

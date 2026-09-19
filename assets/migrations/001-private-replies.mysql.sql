-- Back up first. Run ONCE on the existing MySQL database before starting this fork.
-- Change wl_Comment if MYSQL_PREFIX differs. Do NOT run assets/waline.sql on existing data.
ALTER TABLE wl_Comment
  ADD COLUMN visibility ENUM('public','private') NOT NULL DEFAULT 'public',
  ADD COLUMN private_user_a INT UNSIGNED DEFAULT NULL,
  ADD COLUMN private_user_b INT UNSIGNED DEFAULT NULL;

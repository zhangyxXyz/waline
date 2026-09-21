-- Back up first; replace wl_Comment if MYSQL_PREFIX differs.
-- Both NULL and 0 mean unpinned. Mixing them makes sticky-first sorting split
-- unpinned comments into separate groups before applying time/like ordering.
ALTER TABLE `wl_Comment` ALTER COLUMN `sticky` SET DEFAULT 0;
UPDATE `wl_Comment` SET `sticky` = 0 WHERE `sticky` IS NULL;

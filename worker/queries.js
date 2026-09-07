// The conditional INSERT is one atomic SQLite statement: concurrent requests
// cannot both spend the final allowance. No prompt/response text enters D1.
export const RESERVE_SQL = `
INSERT INTO brief_usage(id,session,ip_hash,day,turn,created_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6
WHERE (SELECT count(*) FROM brief_usage WHERE day=?4) < 100
  AND (SELECT count(*) FROM brief_usage WHERE day=?4 AND ip_hash=?3) < 8
  AND (SELECT count(*) FROM brief_usage WHERE session=?2) < 4
  AND NOT EXISTS(SELECT 1 FROM brief_usage WHERE session=?2 AND turn=?5)
  AND NOT EXISTS(SELECT 1 FROM brief_usage WHERE day=?4 AND ip_hash=?3 AND created_at>?6-5000)
RETURNING id`;

export const ALLOWANCE_SQL = `SELECT
  (SELECT count(*) FROM brief_usage WHERE day=?1) AS daily,
  (SELECT count(*) FROM brief_usage WHERE day=?1 AND ip_hash=?2) AS visitor,
  (SELECT count(*) FROM brief_usage WHERE session=?3) AS session,
  (SELECT count(*) FROM brief_usage WHERE session=?3 AND turn=?4) AS replay`;

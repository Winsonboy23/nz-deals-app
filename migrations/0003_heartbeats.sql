-- 全國版階段 4（2026-10-26）：Mac mini 的心跳表。docs/national-plan.md §2.5 有列但 0001 沒建；
-- worker/ingest.ts 的 POST /ingest/heartbeat 也會 create table if not exists，這裡補成正式 migration（重跑沒事）。
create table if not exists heartbeats (
  name text primary key,                  -- 'price-worker'
  at text not null,
  info text                               -- JSON {browsers, pending, d1_pending, host, version, paused}
);

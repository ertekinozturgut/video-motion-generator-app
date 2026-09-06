-- =============================================================
-- Video Üretim Paneli — 0001_init
-- Şema + RLS + job kuyruğu RPC'leri
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------

create type run_status as enum (
  'RECEIVED','CLAIMS_CHECKED','AWAITING_APPROVAL','APPROVED_FOR_PLANNING',
  'PLAN_QA','READY','RUNNING','COMPLETED',
  'NEEDS_HUMAN','APPROVAL_TIMEOUT','FAILED_TECHNICAL','CANCELLED'
);

create type motion_status as enum (
  'READY','ASSET_READY','SPEC_VALIDATED','RENDERED','QA_APPROVED','UPLOADED',
  'NEEDS_REVISION','NEEDS_HUMAN','FAILED_TECHNICAL','SKIPPED'
);

create type job_type as enum (
  'PLAN_CLAIMS','PLAN_MOTIONS','PLAN_QA','GEN_ASSETS','GEN_SPEC',
  'RENDER','RENDER_POLL','QA_MOTION','PUBLISH','REPORT'
);

create type job_status as enum ('QUEUED','RUNNING','DONE','FAILED','CANCELLED');

create type provider_kind as enum
  ('openai','azure_foundry','anthropic','openrouter','omniroute');

create type provider_status as enum ('unverified','active','degraded','disabled');
create type data_policy   as enum ('no_training','unknown','may_train');
create type network_scope as enum ('public','local_worker_only');

create type pipeline_step as enum (
  'PLAN_CLAIMS','PLAN_MOTIONS','PLAN_QA','GEN_SPEC','ASSET_QA','QA_MOTION','REPAIR'
);

-- ---------- runs ----------

create table video_runs (
  run_id                uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references auth.users(id) on delete cascade,
  title                 text,
  source_script         text not null,
  status                run_status not null default 'RECEIVED',

  audience_profile_json jsonb,
  claim_ledger_json     jsonb,
  style_contract_json   jsonb,
  routing_snapshot_json jsonb,          -- run başlarken dondurulan model routing
  settings_json         jsonb not null default '{}'::jsonb,

  budget_limit          numeric(10,4) not null default 0,
  estimated_cost        numeric(10,4) not null default 0,
  actual_cost           numeric(10,4) not null default 0,

  registry_version      text,
  gdrive_folder_id      text,
  final_report_path     text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  approved_at           timestamptz,
  completed_at          timestamptz
);

create index on video_runs (owner_id, created_at desc);
create index on video_runs (status) where status not in ('COMPLETED','CANCELLED');

-- ---------- motions ----------

create table motions (
  motion_id             uuid primary key default gen_random_uuid(),
  run_id                uuid not null references video_runs(run_id) on delete cascade,
  owner_id              uuid not null references auth.users(id) on delete cascade,

  motion_index          int  not null,
  name                  text,
  start_ms              int  not null,
  end_ms                int  not null,
  motion_type           text,
  original_description  text,

  motion_plan_json      jsonb,
  remotion_spec_json    jsonb,
  status                motion_status not null default 'READY',

  plan_attempt          int not null default 0,
  image_attempt         int not null default 0,
  render_attempt        int not null default 0,
  qa_attempt            int not null default 0,

  factuality_score      numeric(4,2),
  visual_score          numeric(4,2),
  style_qa_score        numeric(4,2),

  idempotency_key       text,
  final_video_path      text,
  gdrive_path           text,

  last_error_code       text,
  last_error_fingerprint text,
  same_error_count      int not null default 0,
  no_improvement_count  int not null default 0,

  actual_cost           numeric(10,4) not null default 0,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (run_id, motion_index)
);

create index on motions (run_id, motion_index);
create index on motions (owner_id, status);
create index on motions (idempotency_key) where idempotency_key is not null;

-- ---------- job kuyruğu ----------

create table jobs (
  job_id         uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id) on delete cascade,
  run_id         uuid not null references video_runs(run_id) on delete cascade,
  motion_id      uuid references motions(motion_id) on delete cascade,

  job_type       job_type   not null,
  payload_json   jsonb      not null default '{}'::jsonb,
  status         job_status not null default 'QUEUED',

  priority       int        not null default 0,
  attempt        int        not null default 0,
  max_attempts   int        not null default 3,

  scheduled_for  timestamptz not null default now(),
  lease_until    timestamptz,
  worker_id      text,

  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- kuyruk taraması bu index üzerinden gider
create index jobs_pickup_idx
  on jobs (priority desc, created_at)
  where status = 'QUEUED';

create index on jobs (run_id);
create index jobs_lease_idx on jobs (lease_until) where status = 'RUNNING';

-- ---------- attempts / artifacts / events ----------

create table attempts (
  attempt_id      uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  run_id          uuid not null references video_runs(run_id) on delete cascade,
  motion_id       uuid references motions(motion_id) on delete cascade,

  step            text not null,          -- pipeline_step veya RENDER/GEN_ASSETS
  provider_id     uuid,
  model_key       text,
  fallback_index  int  not null default 0,
  json_mode_tier  text,                   -- native | tool | prompt
  schema_repair_count int not null default 0,

  input_hash      text,
  latency_ms      int,
  input_tokens    int,
  cached_input_tokens int,
  output_tokens   int,
  cost_usd        numeric(10,6) not null default 0,

  result          text,                   -- ok | schema_fail | provider_error | timeout
  error_code      text,
  score_before    numeric(4,2),
  score_after     numeric(4,2),

  created_at      timestamptz not null default now()
);

create index on attempts (run_id, created_at desc);
create index on attempts (model_key, created_at desc);

create table artifacts (
  artifact_id     uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  run_id          uuid not null references video_runs(run_id) on delete cascade,
  motion_id       uuid references motions(motion_id) on delete cascade,

  artifact_type   text not null,          -- image | video | contact_sheet | spec | report
  storage_path    text,                   -- Supabase Storage yolu
  local_path      text,
  gdrive_id       text,
  sha256          text,
  bytes           bigint,
  metadata_json   jsonb not null default '{}'::jsonb,
  retention_until timestamptz,

  created_at      timestamptz not null default now()
);

create index on artifacts (run_id, artifact_type);
create index on artifacts (retention_until) where retention_until is not null;

create table events (
  event_id     bigserial primary key,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  run_id       uuid references video_runs(run_id) on delete cascade,
  motion_id    uuid references motions(motion_id) on delete cascade,

  event_type   text not null,
  prev_state   text,
  new_state    text,
  job_id       uuid,
  message      text,
  metadata_json jsonb not null default '{}'::jsonb,

  created_at   timestamptz not null default now()
);

create index on events (run_id, created_at desc);

-- ---------- provider katmanı ----------

create table providers (
  provider_id     uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,

  kind            provider_kind   not null,
  label           text            not null,
  base_url        text,
  config_json     jsonb           not null default '{}'::jsonb,

  status          provider_status not null default 'unverified',
  data_policy     data_policy     not null default 'unknown',
  network_scope   network_scope   not null default 'public',

  last_checked_at timestamptz,
  last_latency_ms int,
  last_error      text,
  consecutive_failures int not null default 0,
  degraded_until  timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (owner_id, label)
);

-- Anahtarlar ayrı tabloda: hiçbir select bunu tarayıcıya döndürmez.
create table provider_credentials (
  credential_id uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references providers(provider_id) on delete cascade,
  owner_id      uuid not null references auth.users(id) on delete cascade,

  ciphertext    bytea not null,
  iv            bytea not null,
  auth_tag      bytea not null,
  key_version   int   not null default 1,
  last4         text  not null,

  created_at    timestamptz not null default now(),
  rotated_at    timestamptz
);

create table provider_models (
  model_id      uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references providers(provider_id) on delete cascade,
  owner_id      uuid not null references auth.users(id) on delete cascade,

  model_key     text not null,          -- API'ye giden string / Azure deployment adı
  display_name  text,
  family        text not null default 'unknown',
  capabilities  jsonb not null default '{}'::jsonb,
  pricing       jsonb not null default '{}'::jsonb,

  enabled       boolean not null default true,
  source        text not null default 'synced',   -- synced | manual
  last_synced_at timestamptz,

  created_at    timestamptz not null default now(),

  unique (provider_id, model_key)
);

create index on provider_models (owner_id, enabled);

create table model_presets (
  preset_id  uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table model_routes (
  route_id           uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users(id) on delete cascade,
  preset_id          uuid not null references model_presets(preset_id) on delete cascade,

  step               pipeline_step not null,
  primary_model_id   uuid not null references provider_models(model_id) on delete restrict,
  fallback_model_ids uuid[] not null default '{}',

  params             jsonb   not null default '{}'::jsonb,
  flags              jsonb   not null default '{"disable_compression":true,"allow_auto_alias":false}'::jsonb,
  max_cost_per_call  numeric(10,6),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (preset_id, step)
);

create table provider_health (
  health_id   bigserial primary key,
  provider_id uuid not null references providers(provider_id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  ok          boolean not null,
  latency_ms  int,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index on provider_health (provider_id, created_at desc);

-- ---------- updated_at tetikleyicisi ----------

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger t_runs_touch    before update on video_runs   for each row execute function touch_updated_at();
create trigger t_motions_touch before update on motions      for each row execute function touch_updated_at();
create trigger t_jobs_touch    before update on jobs         for each row execute function touch_updated_at();
create trigger t_prov_touch    before update on providers    for each row execute function touch_updated_at();
create trigger t_routes_touch  before update on model_routes for each row execute function touch_updated_at();

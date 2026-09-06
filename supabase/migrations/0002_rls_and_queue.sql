-- =============================================================
-- 0002 — RLS politikaları, job kuyruğu RPC'leri, Realtime
-- =============================================================

-- ---------- RLS ----------
-- Kural: her tabloda owner_id = auth.uid(). Tarayıcı anon key ile bağlanır,
-- job handler'ları service role ile bağlanır ve RLS'i bypass eder.

alter table video_runs           enable row level security;
alter table motions              enable row level security;
alter table jobs                 enable row level security;
alter table attempts             enable row level security;
alter table artifacts            enable row level security;
alter table events               enable row level security;
alter table providers            enable row level security;
alter table provider_credentials enable row level security;
alter table provider_models      enable row level security;
alter table model_presets        enable row level security;
alter table model_routes         enable row level security;
alter table provider_health      enable row level security;

-- Okuma + yazma sahibine açık olan tablolar
do $$
declare t text;
begin
  foreach t in array array[
    'video_runs','motions','providers','provider_models',
    'model_presets','model_routes'
  ] loop
    execute format($f$
      create policy %1$s_owner_all on %1$s
        for all
        using (owner_id = auth.uid())
        with check (owner_id = auth.uid());
    $f$, t);
  end loop;
end $$;

-- Sadece okunabilen tablolar (yazma yalnız service role ile)
do $$
declare t text;
begin
  foreach t in array array['attempts','artifacts','events','jobs','provider_health'] loop
    execute format($f$
      create policy %1$s_owner_read on %1$s
        for select using (owner_id = auth.uid());
    $f$, t);
  end loop;
end $$;

-- Kimlik bilgileri: hiçbir client rolü okuyamaz. Politika yok = erişim yok.
-- Yalnız service role (RLS bypass) çözebilir.
-- Panel maskelenmiş görünümü aşağıdaki view'dan alır.

create view provider_credentials_masked
with (security_invoker = true) as
  select c.credential_id,
         c.provider_id,
         c.owner_id,
         c.last4,
         c.key_version,
         c.created_at,
         c.rotated_at
  from provider_credentials c
  where c.owner_id = auth.uid();

-- ---------- job kuyruğu ----------

-- Birden fazla worker/function aynı anda çağırsa bile aynı job iki kez
-- alınmaz: SKIP LOCKED satırı kilitli olanları atlar.
create or replace function claim_next_jobs(
  p_worker_id     text,
  p_limit         int default 5,
  p_lease_minutes int default 15
)
returns setof jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update jobs j
     set status      = 'RUNNING',
         worker_id   = p_worker_id,
         lease_until = now() + make_interval(mins => p_lease_minutes),
         attempt     = j.attempt + 1,
         updated_at  = now()
   where j.job_id in (
     select job_id
       from jobs
      where status = 'QUEUED'
        and scheduled_for <= now()
      order by priority desc, created_at
      limit p_limit
      for update skip locked
   )
  returning j.*;
end $$;

-- Lease'i dolmuş RUNNING job'ları geri kuyruğa alır.
-- Function ortasında deploy olsa, crash olsa da iş kaybolmaz.
create or replace function requeue_expired_jobs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  with expired as (
    update jobs
       set status      = case when attempt >= max_attempts then 'FAILED' else 'QUEUED' end,
           worker_id   = null,
           lease_until = null,
           last_error  = coalesce(last_error, 'lease expired'),
           updated_at  = now()
     where status = 'RUNNING'
       and lease_until < now()
    returning 1
  )
  select count(*) into n from expired;
  return n;
end $$;

-- Job tamamlama yardımcıları
create or replace function complete_job(p_job_id uuid)
returns void language sql security definer set search_path = public as $$
  update jobs set status='DONE', lease_until=null, updated_at=now() where job_id=p_job_id;
$$;

create or replace function fail_job(p_job_id uuid, p_error text, p_retry_in_seconds int default 60)
returns void language plpgsql security definer set search_path = public as $$
begin
  update jobs
     set status = case when attempt >= max_attempts then 'FAILED' else 'QUEUED' end,
         scheduled_for = now() + make_interval(secs => p_retry_in_seconds),
         lease_until = null,
         worker_id = null,
         last_error = p_error,
         updated_at = now()
   where job_id = p_job_id;
end $$;

revoke execute on function claim_next_jobs(text,int,int)  from anon, authenticated;
revoke execute on function requeue_expired_jobs()          from anon, authenticated;
revoke execute on function complete_job(uuid)              from anon, authenticated;
revoke execute on function fail_job(uuid,text,int)         from anon, authenticated;

-- ---------- Realtime ----------
-- Panel bu iki tabloyu dinler, polling yapmaz.

alter publication supabase_realtime add table motions;
alter publication supabase_realtime add table events;
alter publication supabase_realtime add table video_runs;

-- =============================================================
-- Video Üretim Paneli — 0004_security_hardening
--
-- Canlı veritabanına elle uygulanmış sertleştirmenin repo karşılığı.
-- Şema ile canlı DB'nin ayrışmaması için buraya alındı; içeriği
-- uygulanan migration ile birebir aynı.
-- =============================================================

-- 1) provider_credentials: niyeti açık kılan, tümünü reddeden politika.
--    Anahtarları yalnız service role (RLS bypass) çözebilir.
create policy provider_credentials_no_client_access on provider_credentials
  for all to anon, authenticated
  using (false) with check (false);

-- 2) touch_updated_at search_path sabitleniyor.
create or replace function touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- 3) SECURITY DEFINER fonksiyonları PostgREST üzerinden çağrılamamalı.
--    Kuyruk fonksiyonları zaten service role ile çağrılıyor; is_admin ve
--    handle_new_user yalnız politikaların/trigger'ların içinden kullanılıyor.
revoke execute on function is_admin()            from anon, authenticated;
revoke execute on function handle_new_user()     from anon, authenticated;
revoke execute on function touch_updated_at()    from anon, authenticated;
revoke execute on function claim_next_jobs(text,int,int) from anon, authenticated;
revoke execute on function requeue_expired_jobs()        from anon, authenticated;
revoke execute on function complete_job(uuid)            from anon, authenticated;
revoke execute on function fail_job(uuid,text,int)       from anon, authenticated;

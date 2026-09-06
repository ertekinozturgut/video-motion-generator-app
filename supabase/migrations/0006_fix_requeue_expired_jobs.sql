-- =============================================================
-- Video Üretim Paneli — 0006_fix_requeue_expired_jobs
--
-- 0002'deki requeue_expired_jobs() hiç çalışmamış. CASE dallarındaki
-- tipsiz metin sabitleri text olarak çözülüyor, status sütunu ise
-- job_status enum'u:
--
--     42804 — column "status" is of type job_status
--             but expression is of type text
--
-- Aynı dosyadaki claim_next_jobs() düz `status='RUNNING'` atadığı için
-- sorunsuz; sabit doğrudan sütun tipine uyarlanıyor. Hata yalnız CASE
-- kullanıldığında çıkıyor, çünkü CASE dalları önce kendi aralarında
-- birleştiriliyor ve sonuç text oluyor.
--
-- Etkisi sessizdi: lease'i dolmuş işleri toparlayan güvenlik ağı hiçbir
-- zaman çalışmadı. Ölen bir worker'ın işi RUNNING'de asılı kalırdı ve
-- kuyruk kendini toparlayamazdı. Cron bu çağrının hatasını yutuyor
-- (worker/tick yalnız data'yı okuyor), o yüzden hiçbir yerde görünmedi;
-- yönetim ekranındaki "Süresi dolanları topla" düğmesi hatayı ilk kez
-- yüzeye çıkardı.
-- =============================================================

create or replace function requeue_expired_jobs() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with expired as (
    update jobs
       set status = case
                      when attempt >= max_attempts then 'FAILED'::job_status
                      else 'QUEUED'::job_status
                    end,
           worker_id = null,
           lease_until = null,
           last_error = coalesce(last_error, 'lease expired'),
           updated_at = now()
     where status = 'RUNNING' and lease_until < now()
    returning 1
  )
  select count(*) into n from expired;
  return n;
end $$;

-- 0004'teki sertleştirme korunuyor. CREATE OR REPLACE mevcut ACL'i
-- koruyor ama niyeti açık bırakmak için tekrar yazıyoruz.
revoke execute on function requeue_expired_jobs() from anon, authenticated;

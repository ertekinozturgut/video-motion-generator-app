-- =============================================================
-- Video Üretim Paneli — 0007_step_traces
--
-- attempts tablosu bir adımın ÖLÇÜMÜNÜ tutuyor: hangi model, kaç token,
-- kaç ms, sonuç ne. Tutmadığı şey içerik: gönderilen prompt ve dönen
-- yanıt. Bir QA adımı "neden bu puanı verdi" sorusunu ölçümlerle
-- cevaplayamazsın; metni görmen gerekir.
--
-- Ayrı tablo, çünkü bu satırlar büyük. attempts liste ekranlarında
-- taranıyor; prompt gövdelerini oraya koymak her listelemeyi
-- megabaytlarca veri çeker hale getirirdi. Burada 1:1 ilişkiyle duruyor
-- ve yalnız açıldığında okunuyor.
-- =============================================================

create table step_traces (
  trace_id       uuid primary key default gen_random_uuid(),
  attempt_id     uuid references attempts(attempt_id) on delete cascade,

  owner_id       uuid not null references auth.users(id) on delete cascade,
  run_id         uuid not null references video_runs(run_id) on delete cascade,
  motion_id      uuid references motions(motion_id) on delete cascade,
  job_id         uuid,

  step           text not null,
  provider_label text,
  model_key      text,

  request_json   jsonb,   -- gönderilen mesajlar + parametreler, olduğu gibi
  response_text  text,    -- ham metin yanıt
  response_json  jsonb,   -- şemaya oturmuş çıktı
  usage_json     jsonb,   -- token sayaçları, sağlayıcı ne döndürdüyse
  error_text     text,

  created_at     timestamptz not null default now()
);

create index on step_traces (run_id, created_at desc);
create index on step_traces (attempt_id);
create index on step_traces (motion_id) where motion_id is not null;

alter table step_traces enable row level security;

-- Sahibi kendi kayıtlarını okur. Yazma yalnız service role'da: trace'i
-- pipeline üretir, hiçbir client eklemez ya da düzeltmez.
create policy step_traces_owner_read on step_traces
  for select to authenticated
  using (owner_id = auth.uid());

create policy step_traces_no_client_write on step_traces
  for all to anon, authenticated
  using (false) with check (false);

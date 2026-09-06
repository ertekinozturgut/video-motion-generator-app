# Sprint 1 — State akışı (VP-020 → VP-026)

LLM yok, render yok, harcama yok. Amaç iskeleti doğrulamak.

## Ne çalışıyor

Senaryo yükle → `PLAN_CLAIMS` stub'ı çalışır → run `AWAITING_APPROVAL`'a düşer
→ (Sprint 3'te onay ekranı) → `PLAN_MOTIONS` N motion üretir → her motion
`GEN_ASSETS → GEN_SPEC → RENDER → QA_MOTION → PUBLISH` zincirinden geçer
→ hepsi bitince `REPORT` run'ı `COMPLETED` yapar.

Bunların tamamını `/runs/[id]` ekranından, sayfa yenilemeden izliyorsun.

## Kurulum

```bash
pnpm install
cp .env.example .env.local     # Supabase anahtarları + CRON_SECRET
supabase db push
pnpm --filter @video-panel/web dev
```

Supabase panelinden bir kullanıcı oluştur (Authentication → Users → Add user).
Kayıt ekranı yok; bu tek kişilik bir üretim aracı.

## Sprint 1'de test edilecekler

1. **Eşzamanlılık** — iki tarayıcı sekmesinden aynı anda run başlat.
   `claim_next_jobs` `FOR UPDATE SKIP LOCKED` kullandığı için aynı job iki kez
   işlenmemeli. `attempts` tablosunda çift kayıt varsa bir sorun var.

2. **Lease geri alma** — bir job `RUNNING`'ken dev sunucusunu öldür.
   Cron `requeue_expired_jobs()` ile onu geri kuyruğa almalı.
   Doğrulama: `select * from jobs where status='QUEUED' and attempt > 0;`

3. **Geçersiz geçiş** — DB'den bir motion'ı elle `UPLOADED` yap, sonra
   `GEN_SPEC` job'ı kuyruğa ekle. `assertMotionTransition` fırlatmalı ve job
   `FAILED`'a düşmeli. Sessizce geçmemeli.

4. **Realtime** — `/runs/[id]` açıkken başka bir sekmeden DB'de motion
   durumunu değiştir. Şerit anında güncellenmeli.

## Neden zaman şeridi

Motion bir zaman aralığı. Eşit kutulara bölünmüş bir kart ızgarası, en çok
bilgi taşıyan boyutu (süre) atıyor. Şeritte kısa/uzun motion'lar, boşluklar ve
takılan bölge doğrudan görünüyor.

Amber tek vurgu rengi ve yalnız insan müdahalesi bekleyen durumlara ayrıldı.
Bir izleme panelinde dikkat çekmesi gereken tek şey o; kalan durumlar sessiz.

## Bilinen boşluklar (bilinçli)

- Onay ekranı yok → Sprint 3
- Provider ayarları yok → Sprint 2
- Motion detayı yalnız isim/süre gösteriyor → Sprint 4
- Job eşzamanlılık limiti yok; dispatch başına 3 job. Gerçek render gelince
  ayarlanacak → Sprint 5

## Sonraki: Sprint 2

`/settings/providers` sihirbazı, model senkronu, routing matrisi ve
`route(step).structured()` çağrısı. Sprint 0'daki provider katmanı bu ekranlara
bağlanacak; adapter kodu zaten hazır.

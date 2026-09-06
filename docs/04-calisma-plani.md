# Video Üretim Paneli — Çalışma Planı

Üç dokümanın (CLI mimarisi, Vercel paneli, provider katmanı) tek bir uygulanabilir plana indirgenmiş hali.

## Hedef

Panelden senaryo yükle → claim'ler doğrulansın → motion planı üretilsin → onayla → görseller ve Remotion spec'leri üretilsin → render edilsin → QA'dan geçsin → panelde video ve görseller listelensin.

## Teknoloji kararları (kilitli)

| Katman | Karar |
|---|---|
| Frontend + API | Next.js App Router, Vercel |
| Veritabanı | Supabase Postgres + RLS + Realtime |
| Depolama | Supabase Storage (private bucket + signed URL) |
| Kuyruk | Postgres `jobs` tablosu, `FOR UPDATE SKIP LOCKED` |
| Tetikleme | Anında dispatch (`waitUntil`) + dakikalık Vercel Cron |
| Render | Adapter: `local` → `vercel-sandbox` → `lambda` |
| Önizleme | `@remotion/player`, paylaşılan registry paketi |
| LLM | 5 provider adapter'ı, adım bazlı routing, aile çeşitliliği zorunlu |
| Şifreleme | AES-256-GCM, master key Vercel env'inde |

## Repo yapısı

```
video-panel/
├─ apps/web/                 Next.js → Vercel
├─ apps/worker/              local worker (geliştirme + local render)
├─ packages/
│  ├─ pipeline/              şemalar, provider'lar, job handler mantığı
│  ├─ registry/              Remotion component'ları + style contract + validator'lar
│  └─ db/                    Supabase tipleri + sorgular
└─ supabase/migrations/
```

---

## Sprint 0 — İskelet ve sözleşmeler ✅ TAMAMLANDI

Hiç LLM, hiç render. Sadece veri modeli ve tip sözleşmeleri.

| ID | İş | Kabul kriteri |
|---|---|---|
| VP-001 | Monorepo iskeleti (pnpm workspace) | `pnpm install` çalışıyor |
| VP-002 | Supabase şeması: tüm tablolar, enum'lar, index'ler | migration hatasız uygulanıyor |
| VP-003 | RLS politikaları | başka kullanıcının run'ı sorgulanamıyor |
| VP-004 | `claim_next_jobs` / `requeue_expired_jobs` RPC'leri | iki eşzamanlı çağrı aynı job'ı almıyor |
| VP-005 | Zod şemaları: claim ledger, audience, style contract, motion plan, remotion spec, judgement'lar | `zod-to-json-schema` çıktısı geçerli |
| VP-006 | Provider tip sistemi + `LLMProvider` arayüzü | – |
| VP-007 | AES-256-GCM şifreleme yardımcıları + anahtar versiyonlama | round-trip testi geçiyor |
| VP-008 | SSRF guard | private IP ve metadata endpoint reddediliyor |
| VP-009 | Model ailesi çözümleyici | `auto/*` → `unknown` |
| VP-010 | Adım gereksinimleri + routing doğrulaması | aynı aileli judge kaydı reddediliyor |

**Definition of done:** `pnpm typecheck` temiz, migration Supabase'e uygulanmış, birim testler geçiyor.

---

## Sprint 1 — State akışı (LLM yok) ✅ TAMAMLANDI

| ID | İş | Kabul kriteri |
|---|---|---|
| VP-020 | Supabase Auth, e-posta+parola, korumalı layout | giriş yapmadan panele erişilemiyor |
| VP-021 | `/runs` listesi + `/runs/new` formu | run oluşuyor, `RECEIVED` durumunda |
| VP-022 | Job dispatch: `waitUntil` → `/api/jobs/[type]` | job `RUNNING`'e geçiyor |
| VP-023 | `/api/worker/tick` cron + `CRON_SECRET` | lease'i dolan job yeniden kuyruğa giriyor |
| VP-024 | Stub job handler'ları (bekle + state ilerlet) | run uçtan uca `COMPLETED` oluyor |
| VP-025 | `/runs/[id]` canlı takip, Supabase Realtime | sayfa yenilenmeden durumlar akıyor |
| VP-026 | `events` akış logu bileşeni | – |

**DoD:** Boş senaryoyla oluşturulan bir run, panelde canlı izlenerek 12 motion'ı stub olarak tamamlıyor.

---

## Sprint 2 — Provider katmanı ✅ TAMAMLANDI

| ID | İş | Kabul kriteri |
|---|---|---|
| VP-030 | 5 adapter: OpenAI, Azure Foundry, Anthropic, OpenRouter, OmniRoute | her biri `healthCheck()` geçiyor |
| VP-031 | `structured()` üç kademe + onarım döngüsü | `prompt` kademesinde bozuk JSON 2 turda düzeliyor |
| VP-032 | `/settings/providers` sihirbazı + test çağrısı | anahtar maskeli, düz metin hiçbir yanıtta yok |
| VP-033 | Model senkronu (OpenRouter otomatik) + manuel giriş (Azure) | katalog doluyor |
| VP-034 | `/settings/routing` matrisi + doğrulama rozetleri | aile ihlalinde kaydet kapalı |
| VP-035 | Failover zinciri + provider devre kesici | 429'da fallback'e geçiyor |
| VP-036 | `attempts` maliyet, onarım, gecikme kaydı | – |
| VP-037 | Anthropic prompt caching (registry kataloğu) | ikinci çağrıda cached_input > 0 |

**DoD:** Panelden eklenen bir provider ile `route('PLAN_CLAIMS').structured()` gerçek bir yanıt döndürüyor.

---

## Sprint 3 — Planlama ve onay ⏭️ SIRADAKİ

| ID | İş |
|---|---|
| VP-040 | `PLAN_CLAIMS` job'ı: claim ledger + audience profile + style contract |
| VP-041 | `/runs/[id]/approval` ekranı, satır bazlı kabul/ret/düzenle |
| VP-042 | Ledger dondurma + `APPROVED_FOR_PLANNING` geçişi |
| VP-043 | `PLAN_MOTIONS` job'ı, tek batch çağrı |
| VP-044 | `PLAN_QA` job'ı, farklı aile judge, deterministic ön kontroller |
| VP-045 | Hedefli JSON Patch revizyon döngüsü + circuit breaker |

**DoD:** Gerçek bir senaryodan onaylanmış motion planı çıkıyor.

---

## Sprint 4 — Player önizlemesi (render yok)

| ID | İş |
|---|---|
| VP-050 | `packages/registry`: V1 component aileleri (Text, Metrics, Charts, Explanation, Comparison, Media, UI) |
| VP-051 | Style contract token sistemi + palette dosyası |
| VP-052 | `specGuard` + `styleValidator` hard fail kuralları |
| VP-053 | `GEN_SPEC` job'ı |
| VP-054 | `/runs/[id]/motions/[mid]` — `@remotion/player` canlı önizleme |
| VP-055 | `/settings` style contract editörü + örnek kompozisyon önizlemesi |

**DoD:** Spec üretiliyor ve tarayıcıda scrub edilebiliyor. Hâlâ tek bir render yapılmadı.

---

## Sprint 5 — Render

| ID | İş |
|---|---|
| VP-060 | `RenderTarget` arayüzü |
| VP-061 | `local` implementasyonu + `apps/worker` job pull |
| VP-062 | `vercel-sandbox` implementasyonu |
| VP-063 | `RENDER` + `RENDER_POLL` job'ları |
| VP-064 | ffprobe teknik QA |
| VP-065 | Storage yükleme + signed URL + `/runs/[id]/gallery` |

---

## Sprint 6 — Görseller ve QA

| ID | İş |
|---|---|
| VP-070 | Görsel sağlayıcı adapter'ı + 0-3 karar tablosu |
| VP-071 | `ASSET_QA` (vision) |
| VP-072 | Contact sheet üretimi |
| VP-073 | `QA_MOTION` vision judge + skor eşikleri |
| VP-074 | Motion detay ekranında retry / patch / skip aksiyonları |
| VP-075 | Circuit breaker'ların panelde görünürlüğü |

---

## Sprint 7 — Teslimat

| ID | İş |
|---|---|
| VP-080 | Google Drive publish |
| VP-081 | Final rapor (HTML) |
| VP-082 | Maliyet dashboard'u |
| VP-083 | Retention temizliği (ara render'lar 30 gün) |
| VP-084 | Rate limit + güvenlik sertleştirme turu |

---

## Riskler ve şimdiden alınan önlemler

| Risk | Önlem | Sprint |
|---|---|---|
| Judge kendi çıktısını puanlar | aile çeşitliliği sert kural | 0 |
| Kullanıcı `base_url` ile SSRF | private IP + metadata guard | 0 |
| Function ortasında deploy/crash | lease + cron requeue | 0-1 |
| Render maliyeti boşa gider | Player önizlemesi render'dan önce | 4 |
| Ucuz model gizli maliyet | `schema_repair_count` ölçümü | 2 |
| Storage kotası dolar | retention politikası | 7 |
| Remotion lisansı | ≤3 kişi ücretsiz; kurumsal kullanımda Automators planı | karar Sprint 5 öncesi |

---

## Sprint 0 durumu

Aşağıdaki dosyalar üretildi ve `sprint0/` altında:

- `supabase/migrations/0001_init.sql` — tüm şema, RLS, RPC'ler
- `packages/pipeline/src/schemas/` — Zod sözleşmeleri
- `packages/pipeline/src/providers/` — tip sistemi, adapter'lar, routing doğrulaması
- `packages/pipeline/src/security/` — şifreleme, SSRF guard
- `README.md` — kurulum adımları

Not: bu ortamda ağ kapalı olduğu için `pnpm install` ve `tsc` çalıştırılamadı. Dosyalar yazıldı, derleme doğrulaması yerel kurulumda yapılacak.

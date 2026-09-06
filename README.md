# Video Üretim Paneli

Senaryodan Remotion videosu üreten AI destekli pipeline'ın panel sürümü.
Next.js (Vercel) + Supabase (Postgres, Auth, Realtime, Storage).

## Yapı

```
apps/web/                 Next.js uygulaması → Vercel'e bu dizin deploy edilir
packages/pipeline/        Zod şemaları, provider adapter'ları (referans; henüz web'e bağlı değil)
supabase/migrations/      Uygulanmış şema — canlı DB ile eşleşir
```

## Vercel kurulumu

Bu bir monorepo. Projeyi Vercel'e bağlarken:
- **Root Directory:** `apps/web`
- **Framework:** Next.js (otomatik algılanır)

## Ortam değişkenleri (Vercel → Settings → Environment Variables)

```
NEXT_PUBLIC_SUPABASE_URL          https://kgodinlqpqutbrmhnwln.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY     (publishable key)
SUPABASE_SERVICE_ROLE_KEY         (Supabase → Settings → API → service_role — RLS'i bypass eder, asla NEXT_PUBLIC olmaz)
PROVIDER_ENC_KEY_V1               (openssl rand -base64 32 — provider anahtarlarını çözen master anahtar)
PROVIDER_ENC_KEY_CURRENT          1
CRON_SECRET                       (openssl rand -hex 32 — cron ve dispatch çağrılarını korur)
```

## Veritabanı

Şema üç migration ile kuruldu ve canlı: video_runs, motions, jobs, attempts,
artifacts, events + provider katmanı (providers, provider_credentials,
provider_models, model_presets, model_routes) + profiles/roller.

Kuyruk `claim_next_jobs` RPC'si ile `FOR UPDATE SKIP LOCKED` üzerinden çalışır;
`requeue_expired_jobs` lease'i dolan işleri toparlar.

Admin: profiles tablosunda role='admin'. Sağlayıcı ve routing ekranları
yalnız admin'e açık.

## Durum

- Sprint 0: veri modeli, provider adapter çekirdeği ✓
- Sprint 1: state akışı, canlı takip (stub handler'lar) ✓
- Sprint 2: admin rolü, sağlayıcı yönetimi, model dağıtımı ✓
- Sonraki: gerçek LLM çağrıları, Remotion önizleme, render

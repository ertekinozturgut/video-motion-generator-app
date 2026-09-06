# Video Üretim Paneli

Senaryodan Remotion videosu üreten AI destekli pipeline'ın panel sürümü.
Next.js (Vercel) + Supabase (Postgres, Auth, Realtime, Storage).

## Yapı

```
apps/web/                 Next.js uygulaması → Vercel'e bu dizin deploy edilir
packages/pipeline/        Zod şemaları, provider adapter'ları (referans; henüz web'e bağlı değil)
supabase/migrations/      Uygulanmış şema — canlı DB ile eşleşir
docs/                     Devir dokümanı, çalışma planı, mimari notlar
```

Nereden başlayacağını bilmiyorsan `docs/00-HANDOFF.md`.

## Yerel kurulum

```bash
cd apps/web
cp .env.example .env.local     # değerleri doldur
npm install
npm run dev                    # http://localhost:3000
npm run typecheck && npm run build
```

Kayıt ekranı yok; kullanıcıyı Supabase → Authentication → Users bölümünden
ekle. Yönetim ekranları yalnız `profiles.role = 'admin'` olan kullanıcıya açık.

## Vercel kurulumu

Bu bir monorepo. Projeyi Vercel'e bağlarken:
- **Root Directory:** `apps/web`
- **Framework:** Next.js (otomatik algılanır)

Ortam değişkenleri (Production + Preview):

```
NEXT_PUBLIC_SUPABASE_URL          https://<proje-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY     publishable key
SUPABASE_SERVICE_ROLE_KEY         service_role secret — RLS'i bypass eder, asla NEXT_PUBLIC olmaz
PROVIDER_ENC_KEY_V1               openssl rand -base64 32
PROVIDER_ENC_KEY_CURRENT          1
CRON_SECRET                       openssl rand -hex 32
```

`PROVIDER_ENC_KEY_V1` kaybolursa kayıtlı tüm sağlayıcı anahtarları kalıcı
olarak okunamaz olur. Beşi de girilmeden panel "Kuruluma devam et" ekranında
kalır; service role anahtarı eksikse yönetim bölümü ne eksik olduğunu söyler.

Cron `vercel.json` içinde tanımlı ve Hobby planında günde bir çalışır. Pro'ya
geçince `* * * * *` yap — kuyruk asıl o zaman toparlanır.

## Veritabanı

Şema dört migration ile kuruldu ve canlı: video_runs, motions, jobs, attempts,
artifacts, events + provider katmanı (providers, provider_credentials,
provider_models, model_presets, model_routes, provider_health) + profiles/roller.

Kuyruk `claim_next_jobs` RPC'si ile `FOR UPDATE SKIP LOCKED` üzerinden çalışır;
`requeue_expired_jobs` lease'i dolan işleri toparlar. `0004_security_hardening`
provider_credentials'a her client rolünü reddeden politikayı koyar ve
SECURITY DEFINER fonksiyonlarını PostgREST'ten kaldırır.

## Yönetim ekranları

| Ekran | İş |
|---|---|
| `/settings` | Genel bakış — sistem gerçek bir çalışmayı yürütebilir mi, ne eksik |
| `/settings/providers` | Sağlayıcı ekle, bağlantıyı sına, model kataloğunu getir |
| `/settings/routing` | Adım → model dağıtımı, aile çeşitliliği doğrulaması |
| `/settings/queue` | Kuyruk durumu, başarısız işleri yeniden dene / iptal et |

## Durum

- Sprint 0: veri modeli, provider adapter çekirdeği ✓
- Sprint 1: state akışı, canlı takip (stub handler'lar) ✓
- Sprint 2: admin rolü, sağlayıcı yönetimi, model dağıtımı ✓
- Sonraki: gerçek LLM çağrıları (Sprint 3), Remotion önizleme, render

# Video Üretim Paneli — Vercel + Supabase Mimari Planı (V2)

Bir önceki plan CLI tabanlı, tek makinede çalışan bir orchestrator anlatıyordu. Bu plan aynı pipeline'ı web paneline taşıyor: senaryoyu tarayıcıdan yüklüyorsun, ayarları formdan yapıyorsun, üretilen görseller ve videolar ekranda beliriyor.

## 1. Kritik teknik gerçekler (planın dayandığı zemin)

**Vercel Function süre limitleri artık yeterli.** Fluid compute ile varsayılan 300 saniye, Pro planda 800 saniye genel kullanımda, 1800 saniye (30 dakika) beta. LLM çağrıları, claim analizi, motion batch planlama — hepsi bu pencereye rahat sığıyor.

**Remotion render'ı da Vercel'de çalışabiliyor.** Remotion'ın resmi sunucu tarafı render seçenekleri arasında Vercel Sandbox var ve "zaten Vercel müşterisiyseniz en basit kurulum" olarak konumlanıyor. Tek dezavantajı soğuk başlangıç: her render'da bağımlılıklar ve tarayıcı indiriliyor. Alternatifler: Remotion Lambda (en hızlı, dağıtık render, chunk'lara bölüp paralel çalışıyor), Cloud Run, veya kendi sunucun.

**Lisans uyarısı.** Remotion bireyler ve 3 kişiye kadar organizasyonlar için ücretsiz. Bu panel Harpia kapsamında kalırsa sorun yok. Ama Toyota tarafında kurumsal bir araca dönüşürse "Remotion for Automators" devreye giriyor: render başına 0.01 USD, aylık minimum 100 USD. Bu kararı mimariden önce vermek gerekiyor çünkü render hedefini etkiliyor.

**Sonuç: her şey Vercel'de kalabilir.** Ama render'ı bir adapter arkasına almanı öneriyorum, çünkü hacim arttığında Lambda'ya geçmek tek dosya değişikliği olsun.

## 2. Genel mimari

```
Tarayıcı (panel)
   │  Supabase Realtime (canlı durum)
   ▼
Next.js @ Vercel
   ├─ API routes: run oluştur, onayla, job dispatch
   ├─ Cron (/api/worker/tick) — takılan job'ları toparlar
   └─ Job handler routes (her biri ayrı maxDuration)
   │
   ├──► Supabase Postgres  (state + queue, tek doğruluk kaynağı)
   ├──► Supabase Storage   (görseller, videolar, contact sheet, rapor)
   ├──► LLM sağlayıcıları  (plan, judge, spec, vision QA)
   ├──► Görsel sağlayıcısı
   └──► Render Target adapter → local | Vercel Sandbox | Remotion Lambda
```

Bir önceki planın temel ilkesi aynen duruyor: **LLM asla kontrol akışına karar vermez.** State machine, retry sayaçları ve bütçe kontrolü koddadır.

## 3. Monorepo yapısı

```
video-panel/
├─ apps/
│  ├─ web/                        # Next.js → Vercel
│  │  ├─ app/
│  │  │  ├─ (panel)/runs/…
│  │  │  ├─ api/runs/route.ts
│  │  │  ├─ api/jobs/[type]/route.ts    # maxDuration burada
│  │  │  └─ api/worker/tick/route.ts    # cron
│  │  └─ components/
│  └─ worker/                     # opsiyonel local worker (geliştirme + fallback)
└─ packages/
   ├─ registry/                   # ⭐ Remotion component'ları + Zod şemaları + validator'lar
   ├─ pipeline/                   # job handler'ların iş mantığı (web ve worker paylaşır)
   └─ db/                         # Supabase tipleri, sorgular, RPC wrapper'ları
```

`packages/registry` bu mimarinin kalbi. Hem tarayıcıdaki `@remotion/player` önizlemesi hem de render süreci **aynı** component'ları import ediyor. Registry'yi değiştirdiğinde LLM'e giden katalog, tarayıcı önizlemesi ve render çıktısı otomatik senkron kalıyor.

## 4. Veri modeli (Supabase Postgres)

Önceki plandaki tablolar aynen duruyor: `video_runs`, `motions`, `attempts`, `artifacts`, `events`. Web'e geçince üç ekleme gerekiyor:

**`jobs`** — kuyruk
```
job_id, run_id, motion_id, job_type, payload_json,
status, priority, attempt, lease_until, worker_id,
scheduled_for, created_at
```
`job_type`: `PLAN_CLAIMS | PLAN_MOTIONS | PLAN_QA | GEN_ASSETS | GEN_SPEC | RENDER | RENDER_POLL | QA_MOTION | PUBLISH | REPORT`

**`settings`** — proje bazlı style contract, bütçe, model yönlendirmesi, sağlayıcı seçimleri.

**`users` / RLS** — Supabase Auth, e-posta+parola (SteerCo'daki kurulumun aynısı). Her tabloda `owner_id` ve RLS policy.

**Realtime** `motions` ve `events` tablolarında açık. Panel polling yapmıyor, WebSocket üzerinden durum değişikliklerini alıyor.

### Job claim mantığı

Postgres fonksiyonu:
```sql
claim_next_jobs(worker_id text, limit int)
  → UPDATE jobs SET status='RUNNING', lease_until=now()+interval '15 min', worker_id=$1
    WHERE job_id IN (
      SELECT job_id FROM jobs
      WHERE status='QUEUED' AND scheduled_for <= now()
      ORDER BY priority DESC, created_at
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
  RETURNING *;
```

`lease_until` geçmiş RUNNING job'lar cron tarafından tekrar `QUEUED`'a alınır. Function crash olsa, deploy ortasında kesilse bile iş kaybolmuyor.

## 5. Yürütme modeli — en kritik tasarım kararı

Pipeline'ı **bir request'in içinde çalıştırma.** Şu iki mekanizma birlikte çalışır:

**Anında dispatch:** Bir job kuyruğa girdiği anda API route `waitUntil` ile `/api/jobs/[type]`'ı tetikler. Kullanıcı beklemeden yanıt alır, iş arka planda başlar.

**Cron sweep:** Her dakika `/api/worker/tick` çalışır; lease'i dolmuş, dispatch'i kaçmış veya `scheduled_for` zamanı gelmiş job'ları toplar. Güvenlik ağı bu.

Her job tipi ayrı bir route ve kendi `maxDuration`'ı var:

| Job | Tahmini süre | maxDuration |
|---|---|---|
| `PLAN_CLAIMS` | 60-120 sn | 300 |
| `PLAN_MOTIONS` | 90-180 sn | 300 |
| `PLAN_QA` | 60 sn | 300 |
| `GEN_ASSETS` | motion başına 30-90 sn | 300 |
| `GEN_SPEC` | 30-60 sn | 300 |
| `RENDER` | submit + dön | 60 |
| `RENDER_POLL` | poll, bitmemişse yeniden kuyruğa | 60 |
| `QA_MOTION` | 30-60 sn | 300 |

Render'ı senkron beklemiyoruz. `RENDER` işi submit edip `RENDER_POLL` job'ını 15 saniye sonrasına planlıyor. Bu sayede 30 dakikalık function limitine hiç yaklaşmıyorsun.

## 6. Render adapter

```ts
interface RenderTarget {
  submit(spec: RemotionSpec, assets: Asset[]): Promise<{ renderId: string }>
  poll(renderId: string): Promise<{
    status: 'running' | 'done' | 'failed'
    progress: number
    outputUrl?: string
    error?: RenderError
  }>
}
```

Üç implementasyon:
- **`local`** — geliştirme. Kendi makinende `apps/worker` çalışır, Supabase'den job çeker. Dışarı port açmıyorsun, worker pull ediyor.
- **`vercel-sandbox`** — varsayılan prod. Tek vendor, push-to-deploy. Soğuk başlangıç dezavantajı motion başına birkaç saniye ekliyor.
- **`lambda`** — hacim artınca. Dağıtık render sayesinde uzun motion'lar chunk'lara bölünüp paralel işleniyor.

`RENDER_TARGET` env değişkeniyle seçilir. Faz planında local ile başlayıp Sandbox'a geçiyorsun.

## 7. Panelin en güçlü özelliği: render öncesi önizleme

Registry paylaşılan bir paket olduğu için `@remotion/player` tarayıcıda **aynı** component'ları çalıştırabiliyor. Bu şu anlama geliyor:

- Spec üretildiği anda, henüz hiç render yapılmadan, motion'ı tarayıcıda oynatıp scrub edebiliyorsun.
- Style contract ayarlarını (renk, glow opaklığı, font boyutu) değiştirip anında etkisini görüyorsun.
- QA'dan kalan bir motion'ın neden kaldığını render beklemeden anlıyorsun.
- Render maliyeti sadece onaylanan spec'ler için oluşuyor.

n8n'de teknik olarak imkânsız olan şey buydu. Mimarinin bu tarafını erken kurmanı öneriyorum (Faz 3), çünkü tüm spec/registry katmanını render maliyeti ödemeden doğruluyor.

## 8. Panel ekranları

**`/` Dashboard** — aktif run'lar, durum dağılımı, bu ayki maliyet, insan müdahalesi bekleyenler.

**`/runs/new` — senaryo ve ayarlar**
- Senaryo: yapıştır veya `.md`/`.txt`/`.docx` yükle
- Hedef kitle ipucu, dil, format (16:9 / 9:16 Shorts)
- Bütçe limiti (run ve motion başına)
- Model yönlendirmesi: plan modeli, judge modeli (farklı aile zorunlu), vision modeli
- Görsel sağlayıcısı ve motion başına maksimum görsel (0-3)
- Style contract seçimi
- Drive hedef klasörü
- `dry_run` anahtarı: LLM ve render stub'lanır, sadece state akışı test edilir

**`/runs/[id]` — canlı takip**
Motion listesi, her birinde durum çipi, ilerleme çubuğu, deneme sayacı ve anlık maliyet. Sağda `events` tablosundan akan canlı log. Realtime abonelik sayesinde sayfa hiç yenilenmiyor.

**`/runs/[id]/approval` — HITL**
Claim ledger tablosu: claim metni, tipi (`fact`/`statistic`/`quote`/`opinion`/`instruction`), kaynak, confidence, risk. Her satırda kabul / reddet / düzenle / kaynak ekle. Toplu onay butonu. Onaylayınca ledger dondurulur ve planlama job'ı kuyruğa girer. E-posta bekleyip 24 saat timeout'la uğraşmıyorsun; panel zaten açık.

**`/runs/[id]/motions/[mid]` — motion detayı**
Sol: motion planı ve spec JSON'u (diff görünümlü, patch'ler işaretli). Orta: `@remotion/player` canlı önizleme, altında render edilmiş video. Sağ: üretilen görseller, QA skorları (factuality / visual / style) ve judge gerekçesi, deneme geçmişi, error fingerprint'leri. Altta aksiyonlar: yeniden dene, hedefli patch uygula, atla, insan müdahalesi işaretle.

**`/runs/[id]/gallery` — çıktılar**
Tamamlanan motion'lar grid halinde, poster frame ve oynatıcı ile. Toplu indir, Drive'a yükle, final raporu görüntüle.

**`/settings`**
Style contract editörü — renk seçicileri palette JSON'una yazıyor, yanında örnek bir kompozisyon üzerinde canlı Player önizlemesi. Registry katalog görüntüleyici (component aileleri, variant'lar, versiyon). Bütçe limitleri, retention süreleri, sağlayıcı ayarları.

## 9. Güvenlik

SteerCo denetiminde çıkan konuların çoğu burada da geçerli:

- LLM ve görsel sağlayıcı anahtarları **yalnızca** server-side env değişkenlerinde. Tarayıcıya asla inmiyor, `NEXT_PUBLIC_` öneki almıyor.
- Supabase service role key sadece API route'larında; tarayıcı anon key + RLS kullanıyor.
- Tüm tablolarda RLS, `owner_id = auth.uid()` politikası. Bunu Faz 0'da kur, sonra eklemek acı veriyor.
- Storage bucket'ları private; panelde video oynatmak için kısa ömürlü signed URL üret.
- `/api/worker/tick` `CRON_SECRET` header'ı ile korunuyor.
- Kullanıcı senaryosu serbest metin: hiçbir yerde shell'e interpolate edilmiyor. Spec, render'a gitmeden Zod + spec guard'dan geçiyor. Mevcut hard fail kuralların (`Math.random`, çıplak hex, CSS animation) bu katmanda zaten koruma sağlıyor.
- Rate limit: `POST /api/runs` üzerine kullanıcı başına limit, aksi halde bütçeyi bir gecede yakabilecek bir yüzey açıyorsun.

## 10. Maliyet tablosu

| Kalem | Tahmin |
|---|---|
| Vercel Pro | ~20 USD/ay (800 sn limit ve sık cron için gerekli) |
| Supabase | Free ile başlanır; video birikince Pro ~25 USD/ay |
| LLM | Run başına değişken; `attempts` tablosunda takip edilir |
| Görsel üretimi | Motion başına 0-3 görsel; sağlayıcıya göre |
| Render | Sandbox: sandbox çalışma süresi. Lambda: kısa 1080p klipler için render başına sent mertebesi |
| Remotion lisansı | ≤3 kişi ücretsiz; kurumsal kullanımda Automators 0.01 USD/render, min. 100 USD/ay |

Storage retention'ı baştan planla: ara render'ları 30 gün sonra sil, sadece onaylanmış final motion'ları ve raporu sakla. Video dosyaları Supabase kotasını hızlı doldurur.

## 11. Fazlar

**Faz 0 — iskelet.** Monorepo, `packages/registry`, Supabase şeması + RLS + auth, boş panel Vercel'de yayında. Çıktı: giriş yapıp boş run listesi görüyorsun.

**Faz 1 — state akışı, LLM yok.** `jobs` tablosu, claim RPC'si, tick cron'u, dispatch mekanizması. Job handler'lar stub: bekle, state'i ilerlet. Panelde Realtime ile motion'ların durumunun akmasını izliyorsun. Bu faz sistemin iskeletini LLM maliyeti ödemeden doğruluyor.

**Faz 2 — planlama ve onay.** `PLAN_CLAIMS`, `PLAN_MOTIONS`, `PLAN_QA` gerçek LLM çağrılarıyla. Approval ekranı. Artık senaryo yükleyip motion planı üretebiliyorsun.

**Faz 3 — Player önizlemesi.** `GEN_SPEC` + tarayıcı önizlemesi. **Henüz render yok.** Spec kalitesini, registry uyumunu, style validator'ı sıfır render maliyetiyle test ediyorsun. Bu fazda çok şey öğreneceksin.

**Faz 4 — render.** Render adapter, önce `local` (kendi makinen, worker pull ediyor), sonra `vercel-sandbox`. Gallery ekranı, video oynatma, teknik QA (ffprobe).

**Faz 5 — görseller ve QA.** `GEN_ASSETS`, vision judge, retry/patch UI'ı, circuit breaker'ların panelde görünür hale gelmesi.

**Faz 6 — teslimat.** Drive publish (Vercel MCP bağlantın hazır), HTML final rapor, maliyet dashboard'u, retention temizliği.

Her faz tek başına deploy edilebilir ve işe yarar durumda. Faz 3 sonunda elinde zaten gösterilebilir bir ürün oluyor.

## 12. Bir önceki plandan neler değişti

| Konu | V1 (CLI) | V2 (panel) |
|---|---|---|
| Orchestrator | tek process, uzun ömürlü | job kuyruğu + kısa function çağrıları |
| State | SQLite | Supabase Postgres (Realtime için gerekli) |
| Onay | CLI komutu / dosya | panel ekranı, anlık |
| Render | in-process | adapter: local / Sandbox / Lambda |
| Önizleme | yok | `@remotion/player`, render öncesi |
| Artifact | yerel dosya sistemi | Supabase Storage + signed URL |
| Sırlar | `.env` | Vercel server env + Supabase RLS |
| İzleme | CLI + HTML rapor | canlı panel |

Değişmeyenler: state machine, circuit breaker eşikleri, registry kısıtlı spec üretimi, farklı modelle judge, ucuzdan pahalıya QA sıralaması, idempotency key.

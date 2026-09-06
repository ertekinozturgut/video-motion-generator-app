# Claude Code Devir Dokümanı — Video Üretim Paneli

Bu doküman, projeyi hiç bilmeyen bir Claude Code oturumunun tek okumada
bağlamı toplaması için yazıldı. Önce bunu oku, sonra `CALISMA-PLANI.md` ve
ilgili sprint dosyalarına in.

---

## 1. Proje tek cümlede

YouTube senaryosunu → doğrulanmış claim'lere → hedef kitleye uygun motion
planına → kontrollü görsel üretimine → strict Remotion JSON spec'lerine →
render edilmiş, QA'dan geçmiş motion videolarına dönüştüren bir web paneli.
Panelden senaryo yüklenir, ayarlar yapılır, üretilen video ve görseller
ekranda listelenir.

## 2. Nasıl buraya geldik (kararların gerekçesi)

Bunları bilmezsen yanlış yöne gidersin; kod bu kararların üstüne kurulu.

- **n8n bırakıldı.** İş başta n8n ile planlanmıştı. 20+ motion, 4 ayrı retry
  sayacı, bütçe kontrolü ve state machine'i n8n node grafiğinde tutmak
  kırılgandı; en büyük kayıp ayrı HTTP render worker'ı ayakta tutmaktı.
  Kontrol akışı deterministik TypeScript'e taşındı.

- **LLM asla kontrol akışına karar vermez.** State machine, retry sayaçları
  ve bütçe kontrolü kodda. LLM yalnız içerik üretir veya puan verir.
  "Sonra ne olacak" sorusunun cevabı her zaman kodda.

- **Judge farklı model ailesinden olmak ZORUNDA.** Bir kontrol adımının
  (PLAN_QA, QA_MOTION) modeli, ürettiği adımın (PLAN_MOTIONS, GEN_SPEC)
  modelinden farklı aileden olmalı. Aile gateway adından değil ALTTA YATAN
  modelden çıkarılır (lib/providers/family.ts). Bu bir uyarı değil, kaydı
  reddeden bir kontrol (lib/providers/routing.ts + app/api/routing). Kendi
  çıktısını puanlayan pipeline sessizce yanlış çalışır, hiçbir metrikte
  görünmez. Fallback zinciri de bu kurala tabi.

- **Anahtarlar iki katmanla korunur.** Provider API anahtarları AES-256-GCM
  ile şifreli (lib/providers/crypto.ts). Master anahtar Vercel env'inde
  (PROVIDER_ENC_KEY_V1), şifreli metin Supabase'de. Veritabanı ele geçse
  bile anahtarlar açılamaz. provider_credentials tablosunda tümünü reddeden
  RLS politikası var — hiçbir client rolü okuyamaz; panel yalnız son 4 haneyi
  gösterir.

- **base_url SSRF guard'dan geçer** (lib/providers/ssrf.ts). OmniRoute ve
  self-hosted gateway'ler kullanıcı girdisi URL istiyor. Private IP aralıkları
  ve özellikle cloud metadata endpoint'i (169.254.169.254) engellenir,
  hostname değil çözümlenen IP kontrol edilir (DNS rebinding). Private çıkarsa
  provider local_worker_only işaretlenir ve Vercel job'larından gizlenir.

- **Ucuzdan pahalıya QA sıralaması.** Şema → spec guard → style validator →
  ffprobe → vision judge. İlk dördü LLM harcamadan hard fail üretebiliyor;
  pahalı vision çağrısı en sona.

- **Render öncesi Player önizlemesi.** registry paylaşılan paket olacağı için
  @remotion/player tarayıcıda aynı component'ları çalıştırabilir. Spec
  üretilir üretilmez, hiç render yapmadan motion oynatılıp scrub edilebilir.
  Bu n8n'de imkânsızdı; render maliyeti ödemeden tüm spec katmanı doğrulanır.
  (Sprint 4 işi.)

## 3. Teknoloji kararları (kilitli)

| Katman | Karar |
|---|---|
| Frontend + API | Next.js 15 App Router, Vercel |
| Veritabanı | Supabase Postgres + RLS + Realtime |
| Depolama | Supabase Storage (private + signed URL) — Sprint 5 |
| Kuyruk | Postgres jobs tablosu, FOR UPDATE SKIP LOCKED |
| Tetikleme | Anında dispatch (fire-and-forget fetch) + Vercel Cron |
| Render | Adapter: local → vercel-sandbox → lambda — Sprint 5 |
| Önizleme | @remotion/player, paylaşılan registry — Sprint 4 |
| LLM | 5 provider adapter'ı, adım bazlı routing, aile çeşitliliği zorunlu |
| Şifreleme | AES-256-GCM, master key Vercel env'inde |

Provider'lar: OpenAI, Azure AI Foundry, Anthropic, OpenRouter, OmniRoute.

## 4. Şu anki DURUM (2026-09-06)

### Tamamlanan
- **Sprint 0** — veri modeli, Zod şemaları, 5 provider adapter çekirdeği,
  kripto + SSRF + aile + routing doğrulaması.
- **Sprint 1** — state akışı (stub handler'lar, LLM yok), canlı takip
  (Supabase Realtime), zaman şeridi UI, job kuyruğu + cron.
- **Sprint 2** — admin rolü (profiles tablosu), sağlayıcı yönetim ekranı
  (/settings/providers), model senkron + manuel giriş, model dağıtım matrisi
  (/settings/routing), failover + doğrulama.
- **Yönetim yüzeyi** — /settings altında ortak kabuk (yan menü, tek noktadan
  rol kontrolü), genel bakış ekranı (hazırlık kontrol listesi + sayaçlar),
  kuyruk ekranı (/settings/queue: yeniden dene / iptal / süresi dolanları
  topla, POST /api/admin/queue). Doğrulama tek kaynaktan:
  lib/admin/snapshot.ts hem genel bakışı hem dağıtım ekranını besler.

### Canlı altyapı
- **Supabase projesi:** ref `kgodinlqpqutbrmhnwln`, bölge eu-central-1
  (Frankfurt), URL https://kgodinlqpqutbrmhnwln.supabase.co
- **Üç migration uygulandı** (supabase/migrations/ ile birebir): 0001 şema,
  0002 RLS + kuyruk RPC'leri + Realtime, 0003 admin + tohum kullanıcı.
  Ayrıca bir güvenlik sertleştirme migration'ı çalıştırıldı (SECURITY DEFINER
  fonksiyonlarından anon/authenticated EXECUTE revoke, provider_credentials
  reddet politikası, touch_updated_at search_path). Bu artık repoda:
  supabase/migrations/0004_security_hardening.sql — canlı DB ile birebir.
- **Admin kullanıcı:** ertekin456@gmail.com, profiles.role='admin'.
  Parola Supabase → Authentication → Users üzerinden yönetilir; ilk kurulumda
  konan zayıf parola değiştirilmeli. Parolayı bu depoya yazma.
- **Vercel projesi:** video-motion-generator-app, GitHub reposuna bağlı
  (ertekinozturgut/video-motion-generator-app), root directory apps/web.

### Bilinen açık işler
- ~~Build tip hatası~~ düzeltildi ve push edildi: providers/page.tsx içindeki
  `Record<string, never>` cast'i `Omit<ProviderRow, ...>` ile değiştirildi,
  RoutingMatrix'te yinelenen nesne anahtarları giderildi. `npx tsc --noEmit`
  ve `npm run build` temiz.
- **Env değişkenleri Vercel'e girilmeli** yoksa panel "Kuruluma devam et"
  ekranında kalır (bkz. bölüm 6).
- **packages/pipeline henüz apps/web'e bağlı değil.** Provider ve şema kodu
  web içinde lib/providers ve (Sprint 3'te eklenecek) lib/schemas olarak
  ayrıca duruyor. packages/pipeline referans; istersen tek kaynağa indir.
- **Cron günde bir** (Hobby planı sınırı). Pro'ya geçince vercel.json'da
  `* * * * *` yap.

## 5. Sıradaki iş: Sprint 3 (planlama ve onay)

İlk gerçek LLM çağrıları. Stub handler'lar (lib/jobs/handlers.ts) gerçek
işleriyle değişecek; imzalar aynı kalacak.

- PLAN_CLAIMS job'ı: senaryodan claim ledger + audience profile + style
  contract (tek çağrı). Şema packages/pipeline/src/schemas/planning.ts'te
  hazır (ClaimsAndContextSchema).
- /runs/[id]/approval ekranı: claim ledger tablosu, satır bazlı kabul/ret.
- Ledger dondurma + APPROVED_FOR_PLANNING geçişi.
- PLAN_MOTIONS job'ı: tek batch çağrı. Şema motion.ts (MotionBatchSchema).
- PLAN_QA job'ı: farklı aile judge, deterministic ön kontroller. Şema
  PlanJudgementSchema.
- Hedefli JSON Patch revizyon döngüsü + circuit breaker.

route(step).structured(req, Schema) sarmalayıcısı Sprint 3'te yazılacak;
provider adapter'ları (lib/providers/client.ts, structured output üç kademe)
hazır, sadece routing tablosundan model seçip çağıran katman eksik.

Sonraki sprintler CALISMA-PLANI.md'de: 4 Player önizleme, 5 render, 6 görsel
+ QA, 7 teslimat.

## 6. Yerel kurulum (.env.local)

```
NEXT_PUBLIC_SUPABASE_URL=https://kgodinlqpqutbrmhnwln.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase → Settings → API → publishable key>
SUPABASE_SERVICE_ROLE_KEY=<Supabase → Settings → API → service_role secret>
PROVIDER_ENC_KEY_V1=<Vercel env'inden al; openssl rand -base64 32 ile üretildi>
PROVIDER_ENC_KEY_CURRENT=1
CRON_SECRET=<Vercel env'inden al; openssl rand -hex 32 ile üretildi>
```

Aynı beş değişken Vercel → Settings → Environment Variables (Production).
SUPABASE_SERVICE_ROLE_KEY RLS'i bypass eder — asla NEXT_PUBLIC olmaz.
PROVIDER_ENC_KEY_V1 kaybolursa tüm kayıtlı provider anahtarları kalıcı olarak
okunamaz olur.

```
cd apps/web
npm install
npm run dev      # http://localhost:3000
npx tsc --noEmit # bu ortamda ağ kapalıydı, derleme doğrulamasını burada yap
```

## 7. Repo haritası

```
apps/web/
  app/(panel)/              panel sayfaları (runs, settings/providers, settings/routing)
  app/api/                  runs, jobs/[type], worker/tick, providers, routing
  lib/jobs/                 machine.ts (state machine), dispatch.ts, handlers.ts (STUB)
  lib/providers/            client, crypto, ssrf, family, routing, types, load
  lib/supabase/             client, server, admin, cookies, env
  components/               Timeline, status, Setup
packages/pipeline/          Zod şemaları + adapter'lar (referans)
supabase/migrations/        0001, 0002, 0003 — canlı DB ile eşleşir
CALISMA-PLANI.md            sekiz sprint, ticket'lar, kabul kriterleri
```

## 8. İlk yapılacaklar sırası (öneri)

1. `npx tsc --noEmit` — repo derleniyor mu, providers page düzeltmesi geldi mi.
2. Güvenlik sertleştirmesini 0004_security_hardening.sql olarak yaz (bölüm 4).
3. .env.local'i doldur, npm run dev, ertekin456@gmail.com ile giriş.
4. /settings/providers'tan bir provider ekle, bağlantıyı sına, model senkonla.
5. Sprint 3'e başla: PLAN_CLAIMS gerçek çağrısı.

---

**Not:** Bu doküman depoda tutuluyor ve depo herkese açık. Gerçek anahtar,
parola veya token buraya yazılmaz; değerlerin tek kaynağı Vercel ortam
değişkenleri ve Supabase panelidir.

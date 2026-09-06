# AI Provider ve Model Yönetim Katmanı — Detaylı Tasarım

Bu doküman V2 panel planının içindeki LLM katmanını açıyor: panelden provider ekleme, model senkronu, adım bazlı model seçimi, failover ve maliyet takibi.

Desteklenecek provider'lar: **OpenAI**, **Azure AI Foundry**, **Anthropic (Claude)**, **OpenRouter**, **OmniRoute**.

---

## 1. Tasarımın dayandığı ilkeler

1. **Anahtarlar hiçbir koşulda tarayıcıya inmez.** Panel yalnız maskelenmiş son 4 haneyi görür. Alan write-only: değiştirebilirsin, okuyamazsın.
2. **Her adım kendi model gereksinimini bildirir.** Panel yalnız o gereksinimi karşılayan modelleri seçilebilir gösterir.
3. **Judge farklı model ailesinden olmak zorunda.** Bu bir uyarı değil, kaydı reddeden sert bir kural. Kendi çıktısını puanlayan bir pipeline bu sistemdeki en tehlikeli sessiz hata.
4. **Run başladığında routing dondurulur.** Ayarları sonradan değiştirsen bile eski run'ın hangi modellerle üretildiği bilinir.
5. **Gateway'ler şeffaf olmak zorunda.** Hangi modelin cevapladığı bilinmiyorsa o model judge olamaz.

---

## 2. Veri modeli

### `providers`

```
provider_id      uuid pk
owner_id         uuid
kind             'openai' | 'azure_foundry' | 'anthropic' | 'openrouter' | 'omniroute'
label            text            -- "Toyota Azure Prod", "Kişisel OpenRouter"
base_url         text            -- azure ve omniroute için zorunlu, diğerlerinde override
config_json      jsonb           -- kind'e özgü ayarlar
status           'unverified' | 'active' | 'degraded' | 'disabled'
data_policy      'no_training' | 'unknown' | 'may_train'
network_scope    'public' | 'local_worker_only'
last_checked_at, last_latency_ms, last_error
created_at, updated_at
```

### `provider_credentials`

```
credential_id    uuid pk
provider_id      uuid
ciphertext       bytea           -- AES-256-GCM
iv               bytea
key_version      int
last4            text            -- panelde gösterilen tek şey
created_at, rotated_at
```

### `provider_models`

```
model_id         uuid pk
provider_id      uuid
model_key        text            -- API'ye giden string
display_name     text
family           'gpt'|'claude'|'gemini'|'llama'|'qwen'|'deepseek'|'mistral'|'glm'|'other'|'unknown'
capabilities     jsonb
pricing          jsonb
enabled          bool
source           'synced' | 'manual'
last_synced_at
```

`capabilities`:
```json
{
  "json_schema": "native" | "tool" | "prompt",
  "vision": true,
  "tools": true,
  "streaming": true,
  "context_window": 200000,
  "max_output": 16384,
  "reasoning": true
}
```

`pricing`:
```json
{
  "input_per_mtok": 3.0,
  "cached_input_per_mtok": 0.3,
  "output_per_mtok": 15.0,
  "currency": "USD",
  "source": "synced" | "manual"
}
```

### `model_routes`

```
route_id, owner_id, preset_id
step             'PLAN_CLAIMS'|'PLAN_MOTIONS'|'PLAN_QA'|'GEN_SPEC'|'ASSET_QA'|'QA_MOTION'|'REPAIR'
primary_model_id uuid
fallback_model_ids uuid[]        -- sıralı
params           jsonb           -- temperature, max_tokens, reasoning_effort, thinking_budget
flags            jsonb           -- { disable_compression: true, allow_auto_alias: false }
max_cost_per_call numeric
```

### `model_presets`

Adım × model eşleşmesinin isimlendirilmiş seti: "ucuz", "kaliteli", "kurumsal — yalnız Azure". Run oluştururken preset seçiliyor.

### `video_runs` eklemesi

`routing_snapshot_json` — run başlarken tüm route tablosunun kopyası. Reprodüksiyon için.

### `attempts` eklemesi

`provider_id`, `model_key`, `fallback_index`, `schema_repair_count`, `json_mode_tier`, `latency_ms`, `cost_usd`.

---

## 3. Kimlik bilgisi güvenliği

**Şifreleme:** AES-256-GCM. Master anahtar `PROVIDER_ENC_KEY` **Vercel env'inde**, Supabase'de değil. Böylece veritabanı ele geçse bile anahtarlar şifreli kalıyor; iki ayrı sistemin birden düşmesi gerekiyor.

**Erişim:** Çözme işlemi yalnız server-side job handler'larında. Hiçbir API route düz metin anahtar döndürmez. Panel `sk-…4f2a` görür.

**Rotasyon:** `key_version` alanı iki nesil anahtarı aynı anda destekler; eski kayıtlar arka planda yeni anahtara çevrilir.

**Denetim:** Her ekleme/rotasyon/silme `events` tablosuna yazılır — kullanıcı, zaman, provider, ama asla anahtar materyali.

### SSRF koruması (bu özelliğin en önemli güvenlik maddesi)

OmniRoute ve self-hosted kurulumlar kullanıcının `base_url` girmesini gerektiriyor. Bu, sunucunun keyfi bir URL'e istek atması demek. Zorunlu kontroller:

- Private IP aralıkları reddedilir: `10/8`, `172.16/12`, `192.168/16`, `127/8`, ve özellikle `169.254.169.254` (cloud metadata endpoint'i).
- DNS rebinding'e karşı çözümlenen IP kontrol edilir, sadece hostname değil.
- Sadece `https` (local worker istisnası hariç).
- `network_scope = 'local_worker_only'` işaretli provider'lar Vercel route'larından **çağrılamaz**, yalnız kendi makinendeki worker kullanır.

---

## 4. Provider adapter'ları

Ortak arayüz:

```ts
interface LLMProvider {
  kind: ProviderKind

  structured<T>(
    req: NormalizedRequest,
    schema: ZodSchema<T>
  ): Promise<{ data: T; usage: Usage; repairs: number; raw: unknown }>

  vision<T>(
    req: NormalizedRequest & { images: ImageRef[] },
    schema: ZodSchema<T>
  ): Promise<{ data: T; usage: Usage }>

  listModels(): Promise<ProviderModel[]>
  healthCheck(): Promise<HealthResult>
  estimateCost(usage: Usage, model: ProviderModel): Money
}
```

Zod şeması tek doğruluk kaynağı; `zod-to-json-schema` ile provider formatına çevriliyor.

### 4.1 OpenAI

- Base: `https://api.openai.com/v1`
- Structured output: **native** strict JSON schema
- Vision: var
- Model listesi: `/v1/models` ID döner ama yetenek ve fiyat dönmez → paket içindeki metadata tablosuyla birleştirilir, panelden override edilebilir
- Config: `organization_id` (ops.), `project_id` (ops.)

### 4.2 Azure AI Foundry

Bu en çok özel muamele isteyen provider, ve Toyota tarafında muhtemelen kullanacağın olan bu.

- Endpoint: `https://<resource>.services.ai.azure.com` veya `.openai.azure.com`
- **Model adı değil deployment adı** kullanılır. Panelde model senkronu otomatik yapılamaz çünkü deployment listesi yönetim API'sinde ve çoğu kurumsal kurulumda o yetki verilmiyor.
- Çözüm: **manuel deployment girişi**. Form alanları: deployment adı, altta yatan model, aile, context window, yetenekler, fiyat. Bir kez giriliyor, `source='manual'` olarak kaydediliyor.
- `api-version` zorunlu ve deployment başına farklı olabilir → model kaydında tutulur.
- Auth iki mod: `api-key` header'ı veya Entra ID (managed identity / client credentials). Kurumsal ortamda ikincisi istenir; token cache + yenileme adapter'ın içinde.
- Foundry OpenAI dışı modelleri (Llama, Mistral, DeepSeek, Cohere, Grok) farklı bir inference yolundan sunuyor → adapter kind içinde `flavor: 'openai' | 'inference'` ayrımı yapar.
- Structured output: OpenAI deployment'larında native, diğerlerinde `prompt` tier'a düşer.

### 4.3 Anthropic (Claude)

- Base: `https://api.anthropic.com/v1`, `anthropic-version` header'ı
- Structured output: **tool** tier — zorunlu tool call ile şema dayatılır, pratikte native kadar güvenilir
- Vision: native
- **Prompt caching burada ciddi bir kazanç.** `GEN_SPEC` adımında her motion için gönderilen sistem promptu neredeyse aynı: registry kataloğu + style contract + kurallar. Bunu cache'lersen 20 motionluk bir videoda input maliyetinin büyük kısmı düşer. Adapter cache breakpoint'ini otomatik registry katalogunun sonuna koyar.

### 4.4 OpenRouter

- Base: `https://openrouter.ai/api/v1`, OpenAI uyumlu
- **En iyi katalog kaynağı:** `/api/v1/models` fiyat, context uzunluğu ve desteklenen parametreleri döndürüyor → senkron doğrudan bu tablodan beslenir, manuel giriş gerekmez
- `models: []` dizisiyle kendi içinde fallback, `provider: { order, allow_fallbacks }` ile sağlayıcı tercihi
- `provider.data_collection: 'deny'` — **yayınlanmamış senaryolar için bunu varsayılan yap**
- Ücretsiz modeller genelde veri toplamaya açık → bu modeller `data_policy: 'may_train'` olarak işaretlenir
- `HTTP-Referer` ve `X-Title` header'ları

### 4.5 OmniRoute

OmniRoute, MIT lisanslı, kendin barındırdığın, OpenAI uyumlu tek uç nokta sunan bir AI gateway. 290'ın üzerinde sağlayıcı, yüzlerce model, quota bitince otomatik fallback, çok sayıda yönlendirme stratejisi ve token sıkıştırma sunuyor. Varsayılan olarak `localhost:20128` üzerinde çalışıyor.

Bu pipeline'a bağlarken dört özel kısıt var:

**(1) Erişilebilirlik.** Kendin barındırdığın için Vercel `localhost:20128`'e ulaşamaz. Üç seçenek: bir VPS'e TLS ve API key ile deploy et; Fly/RepoCloud gibi bir yere kur; ya da yalnız local worker fazında kullan. Panel `base_url` localhost veya private IP ise provider'ı otomatik `network_scope='local_worker_only'` işaretler ve Vercel job'larından gizler.

**(2) `auto/*` alias'ları judge adımlarında yasak.** Otomatik yönlendirme hangi modelin cevapladığını gizliyor. Bu durumda `family='unknown'` olur ve `PLAN_QA` / `QA_MOTION` route'una kaydedilmesi API tarafından reddedilir. Judge modeli pinlenmiş olmak zorunda.

**(3) Token sıkıştırma şema-kritik adımlarda kapalı.** OmniRoute'un context sıkıştırması maliyeti ciddi düşürüyor ama context'i değiştiriyor. `PLAN_CLAIMS`, `PLAN_MOTIONS` ve `GEN_SPEC` için bu kabul edilemez: claim sadakati ve strict JSON tam context'e bağlı. Route kaydında `disable_compression: true` varsayılan; açmak istersen bilinçli bir tercih olur.

**(4) Keyless/ücretsiz havuzlar.** Veri saklama politikaları bilinmiyor → `data_policy: 'unknown'`. Yayınlanmamış senaryo gören adımlarda kullanılamaz.

Doğru kullanım yeri: `REPAIR` ve deneysel adımlar için ucuz kapasite, ve ana sağlayıcı quota'ya takıldığında son çare fallback.

---

## 5. Structured output stratejisi

Üç kademe, adapter kendi kademesini bildirir:

| Kademe | Nasıl | Kimde |
|---|---|---|
| `native` | `response_format: { type: 'json_schema', strict: true }` | OpenAI, Azure OpenAI deployment'ları |
| `tool` | Zorunlu tool call, `input_schema` şemayı dayatır | Anthropic |
| `prompt` | Şema prompt'ta + `json_object` modu + parse + onarım döngüsü | OpenRouter/OmniRoute üzerindeki çoğu model, Foundry'deki OpenAI dışı modeller |

**Onarım döngüsü:** parse hatası → Zod hata mesajı geri gönderilir, en fazla 2 tur → hâlâ olmuyorsa fallback modele geç → o da olmuyorsa motion `NEEDS_HUMAN`.

`schema_repair_count` her çağrıda `attempts`'e yazılır. Panelde model başına ortalama onarım sayısı gösterilir. Bu, model seçiminde fiyattan daha anlamlı bir kalite sinyali: onarım gerektiren ucuz model aslında ucuz değil.

---

## 6. Yetenek eşleştirmesi

Her adım gereksinimini bildirir, panel yalnız uyanları seçilebilir gösterir, uymayanları sebebiyle birlikte soluk gösterir.

| Adım | JSON şema | Vision | Min context | Ek kısıt |
|---|---|---|---|---|
| `PLAN_CLAIMS` | gerekli | – | 128k | uzun senaryo |
| `PLAN_MOTIONS` | gerekli | – | 128k | en pahalı çağrı, sıkıştırma kapalı |
| `PLAN_QA` | gerekli | – | 128k | **farklı aile**, pinli model |
| `GEN_SPEC` | `native`/`tool` tercihli | – | 32k | prompt cache'e uygun olmalı |
| `ASSET_QA` | – | gerekli | 16k | |
| `QA_MOTION` | gerekli | gerekli | 32k | **farklı aile**, contact sheet girdisi |
| `REPAIR` | tool use | – | 64k | agentic, repo erişimi |

### Aile çeşitliliği kuralı

```
family(PLAN_QA.primary)   ≠ family(PLAN_MOTIONS.primary)
family(QA_MOTION.primary) ≠ family(GEN_SPEC.primary)
```

Aile, gateway'den değil **altta yatan modelden** çıkarılır. OpenRouter'da `anthropic/claude-…` → `claude`. OmniRoute'ta `auto/best-coding` → `unknown` → judge route'una kaydedilemez. Fallback zincirindeki modeller de aynı kurala tabi, aksi halde failover sırasında sessizce kendi kendini puanlayan bir duruma düşersin.

---

## 7. Failover ve devre kesici

Route başına: primary + sıralı fallback zinciri.

Geçiş tetikleyicileri:
- HTTP 429, 5xx, timeout → sıradaki
- Şema onarımı tükendi → sıradaki
- Çağrı maliyeti tavanı aşacak → sıradaki (daha ucuz) ya da hata
- Provider devre kesicisi açık → atla

**Provider devre kesicisi:** 5 dakika içinde 5 ardışık hata → `status='degraded'`, 10 dakika dışlanır, panelde turuncu rozet, cron yeniden yoklar.

Her fiziksel çağrı ayrı bir `attempts` satırı alır (`fallback_index` ile), ama mantıksal deneme sayacı bir kez artar. Yoksa fallback zinciri circuit breaker'ı boşuna tetikler.

---

## 8. Maliyet takibi

- Fiyat kaynağı: OpenRouter senkronla; OpenAI/Anthropic paket metadata'sı + override; Azure ve self-hosted manuel.
- Her çağrıda normalize edilen kullanım: input, cached_input, output, reasoning token.
- `attempts`'e USD yazılır; run ve motion toplamları `video_runs` / `motions` üzerinde tutulur.
- **Bütçe muhafızı çağrıdan önce çalışır:** tahmini maliyet kalan bütçeyi aşıyorsa pahalı çağrı hiç yapılmaz.
- Panel: run başına maliyet kırılımı, adım bazlı dağılım, model bazlı aylık harcama grafiği.

---

## 9. Panel ekranları

### `/settings/providers`

Liste: label, kind ikonu, durum rozeti (aktif / degraded / doğrulanmamış), son gecikme, model sayısı, veri politikası çipi, ağ kapsamı çipi.

**"Provider ekle" sihirbazı:**

1. **Kind seç** — beş kart (OpenAI, Azure AI Foundry, Anthropic, OpenRouter, OmniRoute)
2. **Kind'e özel form:**
   - *OpenAI:* label, API key, organization/project (ops.), base_url override (ops.)
   - *Azure AI Foundry:* label, endpoint, auth modu (api-key / Entra), api-version, **deployment ekleme tablosu** (deployment adı + altta yatan model + aile + context + yetenekler + fiyat)
   - *Anthropic:* label, API key, anthropic-version, prompt caching açık/kapalı
   - *OpenRouter:* label, API key, uygulama başlığı, `data_collection: deny` (varsayılan açık)
   - *OmniRoute:* label, base_url (localhost/private IP girilirse otomatik `local_worker_only` uyarısı), gateway API key, varsayılan sıkıştırma kapalı, `auto/*` alias izni (varsayılan kapalı)
3. **Bağlantıyı test et** — küçük bir çağrı: erişim, gecikme, JSON modu doğrulama, iddia ediyorsa vision doğrulama. Sonuç `provider_health`'e yazılır.
4. **Modelleri senkronla** — destekleyen kind'lerde otomatik, Azure'da manuel giriş.

### `/settings/models`

Tüm modeller tablosu, provider'a göre gruplu. Kolonlar: model, aile, yetenek çipleri (JSON tier, vision, tools, context), fiyat, **ortalama onarım sayısı**, **son 30 gün maliyet**, **son 30 gün hata oranı**, enabled toggle.

Manuel model ekleme (Azure deployment'ları için zorunlu). Fiyat override. Toplu enable/disable.

### `/settings/routing`

Adım × model matrisi. Her satır:
- Adım adı ve gereksinim çipleri
- Primary seçici — **yalnız uygun modeller listelenir**, uygunsuzlar sebep tooltip'iyle soluk
- Fallback zinciri — sürükle-bırak sıralı liste
- Parametreler — temperature, max_tokens, reasoning effort / thinking budget
- Bayraklar — sıkıştırma kapalı, auto-alias izni
- Çağrı başına maliyet tavanı

Üstte iki doğrulama rozeti: "judge aile çeşitliliği ✓" ve "tüm adımlar atanmış ✓". Kırmızıysa kaydet butonu kapalı.

**Preset kaydetme:** "ucuz", "kaliteli", "kurumsal — yalnız Azure", "deneysel".

### `/runs/new` içinde

"Model profili" seçici (preset listesi) + "gelişmiş" açılırında adım bazlı override. Seçim run başlarken `routing_snapshot_json`'a dondurulur.

### `/settings/providers/[id]/logs`

Son çağrılar, hata kodları, gecikme dağılımı, devre kesici geçmişi. Anahtar materyali ve senaryo içeriği bu loglara **yazılmaz**.

---

## 10. Model karşılaştırma (opsiyonel ama değerli)

`model_evals` tablosu ve küçük bir golden set: 3-5 örnek senaryo. Panelden "bu modelleri karşılaştır" dediğinde `PLAN_MOTIONS` ve `GEN_SPEC` adımları aday modellerle çalıştırılır, sonuçlar tabloya yazılır:

- şema geçme oranı (ilk denemede)
- ortalama onarım sayısı
- judge skoru
- gecikme
- çağrı başına maliyet

Model seçimi böylece tahminden ölçüme dönüyor. Bu tabloyu bir kez doldurduğunda hangi adımda hangi modelin işe yaradığı tartışma konusu olmaktan çıkıyor.

---

## 11. Veri politikası zorlaması

`data_policy` sadece bilgi amaçlı bir etiket değil, route kaydında zorlanıyor:

- Yayınlanmamış senaryo gören adımlar (`PLAN_CLAIMS`, `PLAN_MOTIONS`, `GEN_SPEC`) `may_train` veya `unknown` politikalı provider'lara atanamaz.
- Atamak istersen panel açık bir onay ister ve `events`'e kaydeder.
- `REPAIR` ve `ASSET_QA` gibi senaryo metnini görmeyen adımlarda kısıt yok — ucuz kapasiteyi burada kullan.

Toyota tarafındaki bir kurulum için pratik sonuç: `PLAN_*` ve `GEN_SPEC` Azure Foundry'ye, `REPAIR` ve deneysel işler OpenRouter/OmniRoute'a gider.

---

## 12. Faz planına yerleşimi

Bu katman V2 planındaki **Faz 2'nin önüne** giriyor, çünkü ilk gerçek LLM çağrısından önce provider yönetimi hazır olmalı.

**Faz 1.5 — provider katmanı:**
1. `providers`, `provider_credentials`, `provider_models`, `model_routes` tabloları + RLS
2. Şifreleme yardımcıları + SSRF guard
3. Beş adapter, ortak arayüz, `structured()` üç kademeyle
4. `/settings/providers` sihirbazı + test çağrısı
5. `/settings/models` senkron ve manuel giriş
6. `/settings/routing` matrisi + aile çeşitliliği doğrulaması
7. Failover zinciri + devre kesici
8. `attempts` maliyet ve onarım kayıtları

Bu faz bittiğinde Faz 2'deki `PLAN_CLAIMS` job'ı yazarken tek yapman gereken `route('PLAN_CLAIMS').structured(req, ClaimLedgerSchema)` çağırmak. Hangi provider, hangi model, hangi fallback — hepsi bu katmanın sorunu.

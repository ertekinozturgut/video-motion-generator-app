# Claude Tabanlı Video Üretim Pipeline'ı — Mimari Plan (n8n'siz V1)

## 0. Önce bir netleştirme

"Bunu senin içinde yapalım" iki farklı şey olabilir:

**(A) Sohbet içinde, benim her adımı kendim yönettiğim bir akış.** Bunu önermiyorum. 20+ motion, 4 farklı retry sayacı, bütçe kontrolü ve state geçişi olan bir sistemin kontrol akışını bir LLM'in bağlamında tutmak, n8n'den daha kırılgan olur. Oturum düşer, sayaçlar kaybolur, aynı motion iki kez render edilir.

**(B) Kontrol akışı deterministik kodda, karar noktaları bende.** Önerim bu. n8n node grafiğinin yaptığı işi TypeScript bir orchestrator yapar; ben sadece yargı gerektiren 6 noktada devreye girerim. Claude Code ise bu sistemin hem geliştirme ortamı hem de repair agent'ı olur (planındaki Codex'in yerini alır).

Aşağıdaki plan (B)'yi anlatıyor.

## 1. n8n'i bırakınca ne kazanıp ne kaybediyorsun

**Kazanç:**
- Render işi artık container sınırının ötesinde değil. `WF_30_RENDER_WORKER` ve HTTP render servisi tamamen ortadan kalkıyor; Remotion aynı process içinde `@remotion/renderer` ile çağrılıyor.
- State machine gerçek kodda: switch/case yerine tip güvenli geçişler, unit test edilebilir.
- Zod şemaları, registry ve Remotion component'ları tek repoda, tek doğruluk kaynağı. Registry'yi değiştirince LLM'e giden katalog otomatik türeriyor.
- Git'te versiyonlanıyor, diff alınabiliyor. n8n JSON'unda bu yok.
- Prompt/spec/QA çıktıları dosya sistemine düşüyor, gözle bakılabiliyor.

**Kayıp (ve telafisi):**
- Görsel monitoring yok → `pipeline status <run_id>` CLI'ı + run sonunda HTML rapor.
- Credential store yok → `.env` + 1Password/keychain, prod'da environment.
- Wait node / 24 saat timeout yok → DB'de `AWAITING_APPROVAL` + zamanlanmış bir sweep komutu.
- Webhook/Form trigger yok → CLI ile başlatıyorsun; gerekirse ince bir Fastify endpoint'i (30 satır).
- Hazır retry/error workflow yok → hata taksonomisi modülü (zaten n8n'de de kendin yazacaktın).

Net değerlendirme: bu iş için n8n'in getirdiği tek gerçek avantaj görsel izlenebilirlikti; ödediğin bedel ise Postgres'e state taşımak, ayrı bir HTTP render worker'ı ayakta tutmak ve node expression'larıyla boğuşmaktı. Takas senin lehine.

## 2. Katman mimarisi

```
CLI / cron
   │
   ▼
Orchestrator (deterministik TypeScript)
   ├── run state machine
   ├── motion state machine
   ├── budget guard + circuit breaker
   └── artifact & event logger
   │
   ├──► LLM karar noktaları (6 adet, sözleşmeli)
   ├──► Image provider adapter
   ├──► Remotion renderer (in-process)
   └──► SQLite (tek doğruluk kaynağı)
```

Kural: **LLM hiçbir zaman kontrol akışına karar vermez.** LLM sadece içerik üretir veya puan verir. "Sonra ne olacak" sorusunun cevabı her zaman koddadır.

## 3. Altı LLM karar noktası

| # | Adım | Model önerisi | Çıktı sözleşmesi |
|---|---|---|---|
| 1 | Claim ledger + audience profile + style contract | Opus/Sonnet, tek çağrı | `ClaimLedger` + `AudienceProfile` + `StyleContract` (Zod) |
| 2 | Motion batch planı (tüm motion'lar tek çağrıda) | Sonnet, structured output | `MotionPlan[]` |
| 3 | Plan QA judge | **Farklı model ailesi** | `PlanJudgement` (6 skor + hard_fail + JSON Patch) |
| 4 | Remotion spec üretimi (motion başına) | Sonnet, structured output | `RemotionSpec` (registry ID'lerine kısıtlı) |
| 5 | Görsel + içerik QA (vision, contact sheet üzerinde) | Farklı model, vision | `VisualJudgement` |
| 6 | Kod/spec repair (yalnız determinist çözüm yetmezse) | Claude Code headless | git patch |

Planındaki "judge farklı model olsun" ilkesi doğru ve korunmalı. Aynı model kendi çıktısına sistematik olarak yüksek puan verir. Pratik seçenekler: plan üretimi Sonnet, judge tarafı Gemini veya OpenRouter üzerinden başka bir aile. Ücretsiz katmanların gerçek sakıncaları: rate limit dalgalanması, strict JSON'da düşük uyum, ve verinin sağlayıcıda kalması. Senaryoların kamuya açık YouTube içeriği olduğu için gizlilik riski düşük; asıl risk JSON uyumsuzluğu, onu da schema retry ile karşılarsın (2 deneme, sonra ücretli modele fallback).

## 4. Repo yapısı

```
video-pipeline/
├─ src/
│  ├─ cli.ts                  # run | resume | status | approve | sweep | report
│  ├─ orchestrator/
│  │   ├─ runMachine.ts
│  │   ├─ motionMachine.ts
│  │   └─ guards.ts           # bütçe, circuit breaker, idempotency
│  ├─ llm/
│  │   ├─ client.ts           # retry, cost logging, provider routing
│  │   └─ steps/              # claims, motionBatch, planQa, spec, visualQa
│  ├─ schemas/                # Zod: claimLedger, motionPlan, remotionSpec
│  ├─ registry/
│  │   ├─ components.ts       # TEK doğruluk kaynağı
│  │   └─ catalog.gen.json    # LLM'e verilen türetilmiş katalog
│  ├─ validators/
│  │   ├─ specGuard.ts        # Math.random, çıplak hex, CSS animation → hard fail
│  │   └─ styleValidator.ts   # 60/30/10, glow<=0.40, font min, transition sayısı
│  ├─ render/
│  │   ├─ bundle.ts           # run başına bir kez
│  │   ├─ renderMotion.ts
│  │   ├─ probe.ts            # ffprobe teknik QA
│  │   └─ contactSheet.ts     # QA frame'leri
│  ├─ assets/imageProvider.ts # sağlayıcı bağımsız adapter
│  └─ io/{db,artifacts,drive,notify}.ts
├─ remotion/                  # Remotion projesi + component'lar
├─ .claude/
│  ├─ skills/                 # motion-planner, remotion-spec, visual-qa, spec-repair
│  └─ agents/                 # judge.md, repair.md
└─ runs/<run_id>/{input,plan,assets,specs,renders,qa,report}/
```

`remotion-renk-efekt` skill'in burada `registry/` ve `remotion/` katmanına doğrudan bağlanıyor: palette ve motion token'ları style contract'ın kaynağı oluyor, style validator da onları zorluyor.

## 5. State: Postgres yerine SQLite

Tek makinede çalışan, tek yazıcısı olan bir sistem için Postgres gereksiz operasyon yükü. `better-sqlite3` senkron, transaction'lı ve dosya bazlı. Şeman aynen korunuyor:

`video_runs`, `motions`, `attempts`, `artifacts`, `events`

İki ekleme öneriyorum:
- `motions.idempotency_key` = sha256(spec_json + asset_hash'leri + registry_version). Aynı anahtar daha önce başarılı render ürettiyse render atlanır. Retry'larda para yakmayı bu engelliyor.
- `runs.registry_version` — registry değişince eski run'ların neden farklı çıktığı anlaşılabilsin.

PDF'teki Soru 8'in ("bu diziyi n8n değişkeniyle yönetmenin sakıncası var mı") cevabı burada net: dizi hiçbir yerde in-memory tutulmaz, her motion'ın durumu tek tek satır olarak commit edilir. Süreç ortasında crash olursa `pipeline resume <run_id>` kaldığı yerden devam eder.

## 6. State machine ve resume

Run seviyesi ve motion seviyesi planındakiyle aynı kalıyor:

`RECEIVED → CLAIMS_CHECKED → AWAITING_APPROVAL → APPROVED_FOR_PLANNING → PLAN_QA → READY → (motion loop) → COMPLETED`

Motion seviyesi: `READY → ASSET_READY → SPEC_VALIDATED → RENDERED → QA_APPROVED → UPLOADED`

Sapmalar (`NEEDS_REVISION`, `NEEDS_HUMAN`, `APPROVAL_TIMEOUT`, `FAILED_TECHNICAL`, `SKIPPED`) ve circuit breaker eşikleri (3 deneme, `same_error_count >= 2`, `no_improvement_count >= 2`) aynen geçerli.

Tek fark: geçişler bir fonksiyon içinde, transaction ile. `transition(motionId, from, to, reason)` — yanlış geçiş compile time'da veya runtime assertion'da yakalanır.

Motion'lar arasında paralellik: 2-3 eş zamanlı motion. Render CPU-bound olduğu için daha fazlası ters teper. Bundle bir kez yapılır, tüm motion'lar paylaşır.

## 7. Human-in-the-loop (n8n Wait node yerine)

Süreç `AWAITING_APPROVAL`'da DB'ye yazıp **çıkar**. Bekleyen bir process yok.

- `runs/<run_id>/approval/claims.md` yazılır: riskli claim'ler, kaynak, confidence, öneri.
- Sen dosyayı düzenler veya `pipeline approve <run_id> --reject C003,C007` dersin.
- `pipeline sweep` (cron, saatlik) 24 saati geçmiş onayları `APPROVAL_TIMEOUT`'a alır ve mail atar.

Bu, n8n'in Wait node'undan daha sağlam: onay penceresi boyunca ayakta tutulacak bir execution yok.

## 8. Render katmanı

`bundle()` bir kez, `renderMedia()` motion başına, hepsi aynı Node process'inde. HTTP servisi, health endpoint'i, job polling'i yok.

Hata sınıflandırması planındakiyle aynı ama artık stack trace'e doğrudan erişiyorsun:
- eksik asset → asset state'ine dön
- şema/spec hatası → determinist patch
- React/Remotion runtime hatası → önce determinist düzeltme kuralları, sonra repair agent
- OOM → `concurrency` düşür, tekrar dene
- aynı error fingerprint 2 kez → `NEEDS_HUMAN`

**Codex'in yeri:** PDF'te (Soru 11, 18, 22, 23) Codex'i lokal kontrol ve repair için düşünmüşsün. Bu rolü Claude Code headless (`claude -p`) alıyor: repo erişimi var, `remotion/src/components/**` dışına yazma izni yok, çıktısı bir patch, patch sonrası testler koşuluyor. Geçmezse iki denemede `NEEDS_HUMAN`. Bu Codex'ten daha iyi çünkü aynı registry ve style contract'ı skill olarak görebiliyor.

## 9. QA katmanı

Sıralama önemli, ucuzdan pahalıya:

1. **Şema** (Zod) — bedava, milisaniye
2. **Spec guard** — `Math.random`, çıplak hex, CSS animation/transition, eksik clamp → hard fail
3. **Style validator** — 60/30/10, tek aksan, glow ≤ 0.40, grain %3-5, gövde ≥ 28px, transition 12-16 frame
4. **ffprobe** — çözünürlük, fps, süre, codec, siyah frame taraması
5. **Vision judge** — contact sheet + claim ledger + audience profile

İlk dördü LLM harcamadan hard fail üretebiliyor. Vision judge'a gitmeden önce bunların hepsi geçmiş olmalı; pahalı çağrıyı en sona bırakmak maliyeti belirgin düşürüyor.

Eşikler planındaki gibi: factuality ≥ 9, visual ≥ 8, style QA ≥ 9, herhangi bir hard fail varsa ortalamaya bakılmaz.

## 10. Maliyet kontrolü

Her LLM/görsel/render çağrısı `attempts`'e yazılır (model, token, süre, USD). `guards.ts` her pahalı çağrıdan önce run ve motion bütçesini kontrol eder. Aşımda yeni çağrı yapılmaz, motion `SKIPPED` olur ve rapora düşer.

Görsel üretimi (PDF Soru 9, 10): 0-3 kuralı ve karar tablosu aynen korunuyor. Adapter arkasında sağlayıcı değiştirmek tek dosya değişikliği olduğu için fiyat/performans kararını sonraya bırakabilirsin; V1'de tek sağlayıcıyla başla.

## 11. Kurulum sırası (fazlar)

**Faz 0 — LLM yok.** Registry + Zod şemaları + style validator + elle yazılmış bir spec ile tek motion render. Bu faz bitmeden LLM'e dokunma. Sistemin en kırılgan yeri burası, ve burada LLM'in hiç payı yok.

**Faz 1 — spec üretimi.** LLM karar noktası 4 + validator + render + ffprobe. Tek motion, tek komut. Retry ve idempotency burada test edilir.

**Faz 2 — planlama.** Karar noktaları 1, 2, 3. Claim ledger, motion batch, plan QA, onay akışı. Artık tam bir senaryo işleyebiliyorsun.

**Faz 3 — görsel QA ve repair.** Karar noktaları 5 ve 6. Circuit breaker'lar burada gerçek anlam kazanıyor.

**Faz 4 — teslimat.** Drive upload (MCP bağlantın zaten var), HTML final rapor, `sweep` cron'u, opsiyonel HTTP trigger.

Her fazın sonunda bir canary: tek motion, düşük bütçe, dry-run flag'leri açık.

## 12. Bu planı hayata geçirme yöntemi

Claude Code'da repoyu açıp faz faz ilerlemek en verimlisi. Faz 0'ı tek oturumda çıkarmak mümkün. Sonraki her faz için bu dokümanın ilgili bölümü + registry dosyası bağlam olarak yeterli.

`.claude/skills/` altındaki skill'ler iki işe birden yarıyor: hem üretim sırasında LLM adımlarının prompt kaynağı, hem de Claude Code'da geliştirme yaparken benim referansım. Prompt'u tek yerde tutmuş oluyorsun.

# Mimari Değişmezler (Video Üretim Paneli)

Bu kural, projede katman sınırlarının, determinizmin ve LLM/kod sorumluluk ayrımının tavizsiz uygulanmasını güvence altına alır. Tüm geliştirmeler bu anayasaya uymak zorundadır.

## 📚 Dayandığı Literatür ve Standartlar
- **Clean Architecture** (Robert C. Martin) — bağımlılık yönü, sınırlar
- **Designing Data-Intensive Applications** (Martin Kleppmann) — kuyruk, idempotency, at-least-once
- **Release It! (2nd Ed.)** (Michael Nygard) — devre kesici, zaman aşımı, kararlılık desenleri
- **Building Secure and Reliable Systems** (Google SRE) — fail-safe varsayılanlar
- **Next.js App Router & PostgreSQL RLS Documentation**

---

## 1. Katman Mimarisi ve Bağımlılık Yönü

Bağımlılıklar daima içe akar. İç katmanlar dış dünyayı tanımaz:

```
[ app/(panel), app/api  — sunum ve HTTP sınırı ]
        │
        ▼
[ lib/jobs, lib/render  — akış, durum makinesi, deterministik üretim ]
        │
        ▼
[ lib/schemas, lib/prompts  — sözleşmeler; hiçbir şeye bağımlı değil ]
        │
        ▼
[ lib/providers, lib/supabase  — dış dünya adaptörleri ]
```

### Katman Sorumluluk Sınırları
1. **`lib/schemas`** — Zod sözleşmeleri. Supabase, Next.js veya sağlayıcı kodunu import edemez. Sistemin kalbi burasıdır: bir verinin geçerli olup olmadığı yalnız burada tanımlanır.
2. **`lib/prompts`** — Modele söylenen metin. Koddan ayrı tutulur ki bir adımın davranışını değiştirmek için handler'a dokunmak gerekmesin.
3. **`lib/providers`** — Sağlayıcı farklarını eriten adaptör. Anthropic ile OpenAI uyumlu API arasındaki fark **yalnız burada** bilinir; handler hangi sağlayıcıyla konuştuğunu bilmez.
4. **`lib/jobs`** — Durum makinesi, kuyruk, adım yürütücüleri. Akışın tek karar mercii.
5. **`lib/render`** — Deterministik üretim. Model çağıramaz.
6. **`app/api`, `app/(panel)`** — HTTP ve ekran sınırı. İş kuralı barındıramaz.

---

## 2. İhlal Edilemez 10 Kural

### 🏛️ Kural 1: Akış kararını kod verir, model değil
LLM asla hangi adımın çalışacağına, bir sahnenin kabul edilip edilmeyeceğine veya bir durumun geçerli olduğuna karar vermez. Model içerik üretir ve içerik hakkında görüş bildirir; kararı `machine.ts` ve guard'lar verir.
*Gerekçe:* Akış kontrolü modele bırakılan sistem, aynı girdiyle iki farklı yol izler ve hata ayıklanamaz.

### 🏛️ Kural 2: Ölçülebilen şey yargıya bırakılmaz
Çakışma, taşma, süre uyuşmazlığı, onaysız claim kullanımı, şema uyumu — hepsi kodla ölçülür. QA modeline yalnız anlam kusurları kalır.
*Gerekçe:* Modelin kontrolü yapıp yapmadığından emin olamayız; kodun yaptığından oluruz.

### 🏛️ Kural 3: Dış girdi şemadan geçmeden kullanılamaz
HTTP gövdesi ve LLM çıktısı **her zaman** Zod'dan geçer. `as` ile tip zorlama, doğrulama yerine geçmez.
*Gerekçe:* `json_object` modu bir yardımdır, garanti değil. Tek doğrulama otoritesi şemadır.

### 🏛️ Kural 4: Eksik güvenlik alanı güvenli yöne düşer
`risk` yoksa `"high"`, `needs_review` yoksa `true`. Bir alanı zorunlu tutup tüm çıktıyı çöpe atmak da, sessizce en iyimser değeri varsaymak da yanlıştır.
*Gerekçe:* En kötü ihtimalle insan fazladan bir satır okur; tersi, riskli bir iddianın onay ekranını hiç görmemesidir.

### 🏛️ Kural 5: Aynı girdi aynı çıktı (deterministik üretim)
Denetlenen şey ile yayınlanan şey aynı kaynaktan çıkmalıdır. `lib/render` model çağırmaz; sahne tarifi HTML'e kodla çevrilir.
*Gerekçe:* Render deterministik değilse QA'nın onayladığı sahne ile kullanıcının izlediği sahne farklı olabilir — denetim anlamını yitirir.

### 🏛️ Kural 6: Kuyruk kalıcı, tetikleme değil
İş önce `jobs` tablosuna yazılır, sonra tetiklenir. Tetikleme kaçarsa iş kaybolmaz, cron toplar.
*Gerekçe:* Serverless'ta tetikleme kaçar. Kalıcılığı tetiklemeye bağlamak, sessizce kaybolan iş demektir.

### 🏛️ Kural 7: Adımlar idempotent
Aynı iş iki kez çalışabilir (cron + dispatch, lease dolması, insan düğmesi). İkinci tur zarar vermemeli: aynı durum yeniden yazılmamalı, aynı artifact ikinci kez birikmemeli, kapanmış çalışma yeniden kapatılmamalı.

### 🏛️ Kural 8: İçerik kusuru exception değildir
Model şemaya uymayan ya da tasarım olarak kusurlu bir çıktı verdiyse `throw` edilmez — iş yeniden denenir ve aynı sonuca varır. İçerik kusuru `NEEDS_HUMAN`'a gider. `throw` yalnız teknik arıza içindir.

### 🏛️ Kural 9: Çıkmaz durum yasağı
Her durdurucu durumdan bir çıkış yolu olmalıdır. `CANCELLED` gibi geri dönüşsüz bir duruma düşürmek, kurtarılabilir bir alternatif varken tercih edilemez. Durdurma hedefini durum makinesi seçer, kod sabit hedef yazmaz.

### 🏛️ Kural 10: Görünmeyen çağrı olmaz
Her model çağrısı — başarılı ya da değil — `attempts` (ölçüm) ve `step_traces` (gövde) tablolarına yazılır. "Neden bu çıktı geldi" sorusu ancak gönderilen metni görebiliyorsan cevaplanır.

---

## 3. Veri Erişim Standartları

- **`select("*")` yasak.** Kolonlar tek tek yazılır; şema büyüdükçe sessizce büyüyen sorgu, bir gün fonksiyon süresini yer.
- **Sınırsız liste yasak.** Her liste sorgusu `.limit()` alır.
- **N+1 yasak.** Döngü içinde sorgu atılamaz.
- **RLS mi service role mü, bilinçli karar.** Kullanıcının kendi verisi kendi oturumuyla (`createClient`) okunur; sistem yazması `createAdminClient()` ile yapılır ve gerekçesi yorumla yazılır.
- **Yazma sırası anlamlıdır.** Durum geçişi + kuyruk kaydı tek işlem gibi ilerlemeli; yarım kalmış geçiş bırakılmaz.

---

## 4. Zaman ve Süre Standartları

- Fonksiyon süre tavanı **60 sn** (Vercel Hobby) ve yükseltilemez.
- Model çağrılarının toplam bütçesi bu tavanın altında kalır ve **zincire paylaştırılır**: arkasında yedek olan bir denemeye tüm bütçe verilemez, yoksa takılan birincil model yedeği zamansız bırakır.
- Bütçe biterse zincir temiz durur; yarıda kesilen bir çağrı ne sonuç ne hata kaydı bırakır.

---

## 5. Temiz Kod ve Geliştirme Standartları

Fonksiyonlar maksimum **15-25 satır**, en fazla **2 konumsal parametre**; dosyalar maksimum **250-300 satır**. Torba modül (`utils`, `helpers`, `common`) yasak. Ayrıntılı kural seti: `.agents/rules/05-backend-development-clean-code-standards.md`.

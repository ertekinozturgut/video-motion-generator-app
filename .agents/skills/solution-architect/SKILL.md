---
name: solution-architect
description: Katman sınırlarını, Zod şema sözleşmelerini, durum makinesi etkisini ve LLM/kod sorumluluk ayrımını tasarlar; mimari uygunluğu denetler.
---

# Çözüm Mimarı Uzmanlık Rehberi (Video Üretim Paneli Edition)

Bu rehber, projenin mimari bütünlüğünü korumak, katman sınırlarını çizmek, zengin domain modelleri ve arayüz sözleşmeleri (contracts) tasarlamak için izlenecek prosedürleri içerir.

---

## 📚 1. Dayandığı Literatür ve Standartlar

1. **Clean Architecture: A Craftsman's Guide to Software Structure and Design** (Robert C. Martin - Uncle Bob)
2. **Domain-Driven Design: Tackling Complexity in the Heart of Software** (Eric Evans)
3. **Implementing Domain-Driven Design (IDDD)** (Vaughn Vernon)
4. **Patterns of Enterprise Application Architecture (PoEAA)** (Martin Fowler)
5. **Designing Data-Intensive Applications** (Martin Kleppmann) — kuyruk, idempotency, at-least-once
6. **Release It! (2nd Ed.)** (Michael Nygard) — devre kesici, zaman aşımı, kararlılık

---

## 🏗️ 2. Katman Değişmezleri (Invariants)

Bağımlılık kuralı daima **içe doğru**, sözleşmelere işaret eder:

```text
       ┌─────────────────────────────────────────────┐
       │        Sunum: app/(panel), app/api          │
       │   Ekranlar, route handler'lar, HTTP sınırı  │
       └────────────────────┬────────────────────────┘
                            │ (Bağımlıdır)
                            ▼
       ┌─────────────────────────────────────────────┐
       │        Akış: lib/jobs, lib/render           │
       │  Durum makinesi, kuyruk, deterministik      │
       │  üretim, yerleşim guard'ları                │
       └────────────────────┬────────────────────────┘
                            │ (Bağımlıdır)
                            ▼
       ┌─────────────────────────────────────────────┐
       │      Sözleşme: lib/schemas, lib/prompts     │
       │   Zod şemaları, modele söylenen metin       │
       └─────────────────────────────────────────────┘
        ▲ (SIFIR DIŞ BAĞIMLILIK — saf TypeScript + Zod)

       ┌─────────────────────────────────────────────┐
       │  Adaptör: lib/providers, lib/supabase       │
       │  Sağlayıcı farkları, veritabanı istemcisi   │
       └─────────────────────────────────────────────┘
```

### Katman Sınırları ve Kırmızı Çizgiler
1. **Sözleşme katmanı (`lib/schemas`, `lib/prompts`):**
   - **KESİN KURAL:** Supabase, Next.js veya sağlayıcı kodu import edemez. Yalnız `zod` ve saf TypeScript.
   - Bir verinin geçerli olup olmadığı **yalnız burada** tanımlanır; aynı kontrol handler içinde tekrar yazılamaz.
2. **Akış katmanı (`lib/jobs`, `lib/render`):**
   - Durum geçişi, sıradaki iş ve ölçülebilir kusur kontrolü burada. Akışın tek karar mercii.
   - `lib/render` **model çağıramaz**: denetlenen tarif ile yayınlanan dosya aynı kaynaktan çıkmalıdır.
3. **Adaptör katmanı (`lib/providers`):**
   - Anthropic ile OpenAI uyumlu API arasındaki fark **yalnız burada** bilinir. Handler hangi sağlayıcıyla konuştuğunu bilmez.
4. **Sunum katmanı (`app/`):**
   - HTTP ve ekran sınırı. İş kuralı, prompt kurma veya akış kararı barındıramaz. Handler gövdesi maksimum 20 satır.

### Mimarın Üç Değişmezi
- **Karar kodda, LLM'de değil.** Model içerik üretir; hangi adımın çalışacağına, bir çıktının kabul edilip edilmeyeceğine kod karar verir.
- **Ölçülebilen yargıya bırakılmaz.** Çakışma, taşma, süre uyuşmazlığı, onaysız claim kullanımı kodla ölçülür; QA modeline anlam kusurları kalır.
- **Eksik güvenlik alanı güvenli yöne düşer.** Şema tasarlanırken varsayılan değer, en kötü ihtimalle insanı fazladan okutacak yönde seçilir.

---

## 🧩 3. Mimari Tasarım Örüntüleri ve Somut Örnekler

### A. Şema Sözleşmesi: Tolerans ile Katılık Arasındaki Karar
Mimarın en sık verdiği karar, bir alanın eksik gelmesi durumunda ne olacağıdır. Üç seçenek vardır ve ikisi yanlıştır:

```ts
// KÖTÜ 1 — Katı: alan zorunlu.
// 40 iddialık bir döküm, 38'inci maddedeki tek eksik anahtar yüzünden komple çöpe gider.
risk: z.enum(["low", "medium", "high"]),

// KÖTÜ 2 — İyimser: eksik alan en zararsız değere düşer.
// Riskli bir iddia onay ekranını hiç görmeden plana girer. Sessiz ve tehlikeli.
risk: z.enum(["low", "medium", "high"]).default("low"),

// İYİ — Fail-safe: eksik alan GÜVENLİ yöne düşer.
// En kötü ihtimalle insan fazladan bir satır okur.
risk: z.enum(["low", "medium", "high"]).default("high"),
needs_review: z.boolean().default(true),

// İYİ — nullish(), nullable() değil.
// nullable yalnız "değer null olabilir" der, anahtarın YAZILMASINI şart koşar.
// Modeller boş alanları çoğu zaman hiç yazmıyor. Canlıda görüldü.
source: z.string().nullish().default(null),
```

### B. Modelden Ne İstenir, Ne İstenmez
* **KÖTÜ:** Modelden doğrudan HTML/kod istemek. Çıktının ne render edeceği önceden bilinemez: bozuk etiket, dış kaynak, script, okunamayacak kadar küçük yazı.
* **İYİ:** Modelden **yapı tarifi** istemek, üretimi koda bırakmak.
  ```ts
  // Model katman tarif eder (kind, x, y, w, size, enter…)
  const spec = await callStructured({ step: "GEN_SPEC", schema: SceneSpecSchema, ... });
  // HTML'i kod üretir: metin kaçışlanır, tipografi token'larla sınırlı, dış kaynak yok
  const html = renderFilm({ title, style, scenes: [{ motionIndex, title, spec }] });
  ```
* **Kazanç:** Enjeksiyon yüzeyi yok, okunabilirlik tabanı ihlal edilemez, aynı tarif her zaman aynı dosyayı verir.

### C. Durum Makinesi Sözleşmesi
* Geçerli geçişler tek bir tabloda tanımlanır; her durum değişimi assert fonksiyonundan geçer.
* **Çıkmaz durum tasarlanmaz:** Her durdurucu durumdan bir çıkış yolu olmalıdır. `CANCELLED` gibi geri dönüşsüz bir duruma düşürmek, kurtarılabilir bir alternatif varken tercih edilemez.
* Durdurma hedefi **sabit yazılmaz**, makineden seçilir:
  ```ts
  // Sıra önemli: kurtarılabilir durumlar önce.
  const target = (["NEEDS_HUMAN", "FAILED_TECHNICAL", "CANCELLED"] as const)
    .find((t) => { try { assertRunTransition(from, t); return true; } catch { return false; } });
  ```

### D. Devre Kesici ve Süre Bütçesi
* Her yeniden deneme döngüsünün bir sayacı ve bir sonu olmalıdır. Sayaç, döngünün doğduğu işe **taşınmak zorundadır**; taşınmazsa her tur sıfır sayaçla başlar ve döngü hiç kapanmaz.
* Toplam süre bütçesi fonksiyon tavanının altında kalır ve zincire paylaştırılır: arkasında yedek olan denemeye tüm bütçe verilemez.

### E. Kuyruk Sözleşmesi
* Kalıcı kayıt önce yazılır, tetikleme sonra yapılır. Tetikleme kaçarsa iş kaybolmaz.
* Adımlar idempotent tasarlanır: aynı iş iki kez çalışabilir ve ikinci tur zarar vermemelidir.

---

## 📋 4. Adım Adım Mimari Tasarım Protokolü (SOP)

```text
[Adım 1: Gereksinim Ayrıştırma]
  ├── Analistin Gherkin şartnamesini oku.
  └── Hangi verinin sözleşmeye, hangi kararın durum makinesine ait olduğunu ayır.

[Adım 2: Şema Sözleşmesini Tanımla]
  ├── 'lib/schemas/' altında Zod şemasını yaz.
  ├── Her eksik alan için fail-safe varsayılanı seç ve gerekçesini yorumla.
  └── Modelden yapı iste, kod isteme; üretimi deterministik katmana bırak.

[Adım 3: Akış Etkisini Çiz]
  ├── Yeni durum/geçiş gerekiyorsa makineye ekle ve çıkışını da tanımla.
  ├── Devre kesici sayacının hangi işe taşınacağını yaz.
  └── Adımın idempotent olma koşulunu belirt.

[Adım 4: Mimari Uygunluk Denetimi]
  ├── Sözleşme katmanında dış bağımlılık var mı kontrol et.
  ├── İş kuralının route handler'a veya bileşene sızıp sızmadığını denetle.
  └── Aynı kuralın ikinci bir yerde tekrar yazılmadığını doğrula.
```

---

## 🔍 5. Çözüm Mimarının 10 Maddelik Uygunluk Kapısı

| # | Kontrol Kriteri | Beklenen Standart | İhlal Durumunda |
| :--- | :--- | :--- | :--- |
| **1** | **Sözleşme izolasyonu** | `lib/schemas` içinde Supabase/Next.js/sağlayıcı import'u yok. | Varsa ➔ KESİN RED |
| **2** | **Doğrulama otoritesi** | Dış girdi Zod'dan geçiyor; aynı kontrol ikinci kez elle yazılmamış. | `as` ile geçilmişse ➔ RED |
| **3** | **Fail-safe varsayılan** | Eksik güvenlik alanı güvenli yöne düşüyor. | İyimser varsayılan ➔ KESİN RED |
| **4** | **Karar yeri** | Akış kararı kodda; model yalnız içerik üretiyor. | Model karar veriyorsa ➔ KESİN RED |
| **5** | **Determinizm** | Denetlenen ile yayınlanan aynı kaynaktan çıkıyor; `lib/render` model çağırmıyor. | Çağırıyorsa ➔ RED |
| **6** | **Ölçülebilir kontrol** | Çakışma/taşma/süre gibi ölçülebilir kusurlar kodda kontrol ediliyor. | Modele bırakılmışsa ➔ RED |
| **7** | **Çıkmaz durum yasağı** | Her durdurucu durumun bir çıkışı var; hedef makineden seçiliyor. | Sabit hedefse ➔ RED |
| **8** | **Devre kesici** | Yeniden deneme sayacı doğan işe taşınıyor. | Taşınmıyorsa ➔ KESİN RED (sonsuz döngü) |
| **9** | **Kuyruk sırası & idempotency** | Kalıcı kayıt tetiklemeden önce; adım iki kez çalışabilir. | Ters/kırılgansa ➔ RED |
| **10**| **Tek doğru yer** | Kural tek bir modülde tanımlı; kopya yok. | Kopya varsa ➔ Tekilleştir |
| **11**| **İş kuralı sızıntısı** | Route handler ve bileşenlerde iş kuralı yok. | Varsa ➔ RED |
| **12**| **Sıfır derleme hatası** | `tsc --noEmit` + `next build` temiz. | Hata varsa ➔ RED |

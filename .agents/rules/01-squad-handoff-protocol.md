# Squad El Sıkışma (Handoff) ve Görev Döngü Protokolü

Bu kural, ekibin (Squad) görev akışını, roller arası el sıkışma standartlarını ve görev döngü (loop) mekanizmasını düzenler.

## 📚 Dayandığı Literatür ve Standartlar
- **PMBOK Guide & Agile Practice Guide** (Project Management Institute - PMI)
- **The Scrum Guide** (Ken Schwaber & Jeff Sutherland)
- **Accelerate: Building and Scaling High Performing Technology Organizations** (Nicole Forsgren, Jez Humble, Gene Kim)

---

## 1. Görev Durum Makinesi (Task State Machine)
`tasks.json` dosyasındaki her görev şu döngüyü sırayla takip eder:
`pending` ➔ `in_progress` ➔ `in_review` ➔ `completed`

1. **WIP Limiti:** Aynı anda sadece **1 görev** `in_progress` olabilir.
2. **Döngü Tetikleme:** Bir görev `completed` olduğunda orkestratör otomatik olarak sıradaki ilk `pending` görevi seçer.

---

## 2. Roller Arası Handoff (El Sıkışma) Zinciri

Her görev istisnasız aşağıdaki 5 aşamalı zinciri tamamlamak zorundadır:

```
[1. PM] ➔ [2. İş Analisti] ➔ [3. UI/UX & Mimari] ➔ [4. Backend & Frontend Dev] ➔ [5. QA & Security] ➔ [PM: Kapanış]
```

### Aşama 1: Kapsam & Analiz (PM ➔ İş Analisti)
- **Girdi:** Ham kullanıcı isteği veya `tasks.json` görevi.
- **Çıktı:** INVEST formatında Kullanıcı Hikayesi + Gherkin (`Given-When-Then`) kabul kriterleri + Hata senaryoları.

### Aşama 2: Tasarım & Mimari Şartname (Analist ➔ UI/UX & Mimar)
- **UI/UX Tasarımcısı:** Ekran hiyerarşisi, tasarım token'ları, bileşen durum matrisi (hover, focus, disabled, busy) ve boş/hata durumu şartnamesini hazırlar.
- **Sistem Mimarı:** Zod şema sözleşmesini, durum makinesi etkisini ve modül sınırlarını tanımlar.
- **Kapı Kuralı (Definition of Ready - DoR):** Analiz, UX şartnamesi ve tip sözleşmesi hazır olmadan tek satır kod yazılamaz.

### Aşama 3: Geliştirme (Mimar & UX ➔ Backend & Frontend)
- **Backend Engineer:** `.agents/rules/05-backend-development-clean-code-standards.md` ve `.agents/rules/02-architecture-invariants.md` kurallarına tam uyumlu olarak şemaları, adım yürütücülerini, route handler'ları ve veri erişimini kodlar.
- **Frontend Engineer:** Tip sözleşmesine ve UX şartnamesine birebir sadık kalarak App Router ekranlarını paylaşılan `ui.tsx` primitifleri ve tasarım token'larıyla kurar.

### Aşama 4: Kalite ve Güvenlik Kapısı (Dev ➔ QA & Security)
- **QA Tester:** Kabul kriterlerini çalıştırılabilir kontrollere dönüştürür: şema testleri, durum makinesi kapsam testleri, deterministik render doğrulaması ve gerektiğinde tarayıcı üzerinden görsel doğrulama.
- **Security Reviewer:** RLS ve service role sınırı, IDOR, üretilen HTML'de kaçışlama, SSRF, sır sızıntısı ve sessiz yutma denetimlerini yapar.

### Aşama 5: Kapanış (QA & Security ➔ PM)
- **Kapı Kuralı (Definition of Done - DoD):**
  - Tüm kabul kriterleri karşılandı mı? (Evet)
  - `npx tsc --noEmit` ve `npx next build` sıfır hata ile tamamlandı mı? (Evet)
  - Yazılan kontroller yeşil mi? (Evet)
  - Güvenlik kontrol listesi onaylandı mı? (Evet)
  - **Arayüz metni bugünkü davranışı anlatıyor mu?** (Evet — davranış değiştiyse ekran metni aynı işte güncellendi)
- Şartlar sağlandığında görev `completed` yapılır ve sıradaki göreve geçilir.

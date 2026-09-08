# Arayüz ve Deneyim Değişmezleri (UI/UX Invariants)

Bu kural, panelde **Tailwind v4 tasarım token'ları**, **Next.js App Router bileşenleri** ve **Kullanıcı Deneyimi** standartlarının tavizsiz uygulanmasını güvence altına alır.

## 📚 Dayandığı Literatür ve Standartlar
- **The Design of Everyday Things** (Don Norman)
- **Don't Make Me Think, Revisited** (Steve Krug)
- **Refactoring UI** (Adam Wathan & Steve Schoger)
- **WCAG 2.2 Level AA** (W3C)
- **Next.js App Router & React Server Components Documentation**

---

## 1. Tasarım Sistemi ve Görsel Bütünlük

### 🎨 Kural 1: Satır içi stil yasağı
- `style={{ color: "red", marginTop: 10 }}` yazılamaz. Tek istisna, değeri çalışma anında hesaplanan tek bir ölçüdür (ilerleme çubuğu genişliği gibi); o da yorumla gerekçelendirilir.

### 🎨 Kural 2: Keyfi renk ve piksel yasağı
- Rastgele hex (`#4A90E2`), keyfi Tailwind kaçışı (`text-[#888]`, `mt-[13px]`) verilemez.
- Yalnız `globals.css` içindeki `@theme` token'ları kullanılır:
  - Yüzeyler: `bg-ink`, `bg-panel`, `bg-raised`, `border-line`
  - Metin: `text-text`, `text-muted`
  - Durum: `text-attention`, `text-bad`, `text-good`, `text-active` (ve `bg-*`/`border-*` karşılıkları)

### 🎨 Kural 3: Renk bilgi taşır
| Ton | Anlamı |
| :--- | :--- |
| **attention (amber)** | İnsan müdahalesi gerekiyor |
| **bad (kırmızı)** | Teknik hata |
| **good (yeşil)** | Tamamlandı, doğrulandı |
| **active (mavi)** | Şu anda ilerliyor |
| **idle (nötr)** | Bekliyor; bilgi taşımıyor |

Amber ile kırmızı karıştırılamaz: insan kararı bekleyen durumu kırmızı göstermek onu arıza sanmaya, arızayı amber göstermek görmezden gelmeye yol açar. **Her kutuyu renklendirirsen hiçbiri fark edilmez.**

### 🎨 Kural 4: Paylaşılan primitif zorunluluğu
- Kart, başlık, rozet, boş durum, düğme, form alanı, uyarı için `@/components/ui` kullanılır (`Card`, `CardHeader`, `PageHeader`, `Chip`, `Dot`, `Stat`, `CheckRow`, `EmptyState`, `Notice`, `CopyButton`, `Mono`, `btn`, `field`, `Field`).
- Aynı görünümü elle yeniden yazmak yasaktır. Yeni bir desen gerekiyorsa `ui.tsx`'e eklenir.

---

## 2. Bileşen Mimarisi

### 💻 Kural 5: Sunucu bileşeni varsayılandır
- `"use client"` yalnız durum, efekt, tarayıcı API'si veya olay dinleyicisi gerektiğinde yazılır ve **mümkün olan en aşağıdaki yaprakta** durur. Sayfanın tamamını istemciye çevirmek bütün ağacı JS bundle'ına sokar.

### 💻 Kural 6: İş mantığı bileşende olmaz
- Bileşen içinde iş kuralı hesaplaması, akış kararı veya doğrudan veritabanı yazması yapılamaz. Veri sunucu bileşeninde okunur; yazma kendi route handler'ına gider.

### 💻 Kural 7: Monolitik dosya yasağı
- 250 satırı aşan ya da tekrar eden UI blokları ayrı bileşene çıkarılır. Bir sayfa dosyası hem veri okuma hem üç farklı görünüm barındırıyorsa bölünmelidir.

### 💻 Kural 8: `any` yasağı
- Sunucudan gelen satırlar açık tiple daraltılır; props arayüzü bileşenin üstünde tanımlanır.

---

## 3. Kullanıcı Deneyimi Standartları

### ⚡ Kural 9: Beş zorunlu bileşen durumu
Her etkileşimli eleman `default`, `hover`, `focus-visible`, `disabled`, `busy` durumlarını destekler. `btn.*` bunu taşır; elle yazılan düğmede eksikse RED.

### ⚡ Kural 10: Çift gönderim engeli ve kilit çözme
- İstek sürerken düğme `disabled` olur ve metni ne olduğunu söyler ("Kaydediliyor", "Kuyruğa alınıyor").
- `finally` bloğu olmadan `setBusy(false)` yazılmaz: hata durumunda düğme sonsuza kadar kilitli kalır.

### ⚡ Kural 11: Sessiz başarısızlık yasağı
Her hata ekranda görünür. `console.error` ile yutulan hata yasaktır.

### ⚡ Kural 12: Geri alınamaz eylem iki adımlıdır
İlk tıklama tam olarak ne olacağını yazar (kaç kayıt, hangi sonuç), ikincisi uygular.

### ⚡ Kural 13: Sessiz varsayılan yasağı
İnsan kararı bekleyen bir liste, karar verilmeden gönderilemez. Ayrıca bir onay kutusunun anlamı sezgiye ters olamaz: "işaretle = reddet" gibi bir etkileşim, insanın tersini yapmasına yol açar — açık iki düğme kullanılır.

### ⚡ Kural 14: Boş durum tasarımı
Veri yoksa boş sayfa bırakılmaz. `EmptyState` ile: ne olmadığı, **neden** olmadığı ve kullanıcıyı ileri götüren eylem.

### ⚡ Kural 15: Çıkmaz sokak yasağı
"İnsan bekliyor", "onay bekliyor", "eksik var" diyen her ekran, insanın basacağı düğmeyi de gösterir. Durumu bildirip çıkış yolu vermemek en pahalı arayüz hatasıdır.

### ⚡ Kural 16: Arayüz yalan söylemez
Ekrandaki metin sistemin bugünkü davranışını anlatmak zorundadır. Yapılmayan bir şeyi vaat eden ("ücret oluşmuyor"), sonucu etkilemeyen bir alan soran ya da uygulanmayan bir sınır ("bütçe") gösteren arayüz, arayüz kusuru değil **güven kusurudur**. Davranış değiştiğinde ekran metni aynı commit'te güncellenir.

---

## 4. Erişilebilirlik (WCAG 2.2 AA)

- Kontrast en az **4.5:1** (büyük metin 3:1).
- Placeholder etiket yerine geçmez; her input'un `<label>`'ı olur.
- İkon-only düğmede `aria-label`; aç/kapa düğmesinde `aria-pressed`; canlı geri bildirimde `role="status"`.
- Durum yalnız renkle anlatılmaz; metin ya da simge eşlik eder.
- Klavyeyle erişilemeyen etkileşim yasaktır (`div onClick` yerine `button`).

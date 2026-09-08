# Güvenlik ve Kalite Korkulukları (Security Guardrails)

Bu kural, panelin ve ürettiği dosyaların güvenlik açıklarına karşı korunmasını ve kod tabanının sıfır hata toleransıyla inşa edilmesini garanti eder.

## 📚 Dayandığı Literatür ve Standartlar
- **OWASP Top 10** (2021/2025) ve **OWASP ASVS v4.0 Level 2**
- **Secure by Design** (Johnsson, Deogun, Sawano)
- **Building Secure and Reliable Systems** (Google SRE)
- **PostgreSQL Row Level Security Documentation**

---

## 1. Kimlik, Yetki ve Veri İzolasyonu

### 🛡️ Kural 1: `SUPABASE_SERVICE_ROLE_KEY` tarayıcıya asla çıkmaz
- Bu anahtar RLS'i **tamamen aşar**. Asla `NEXT_PUBLIC_` önekiyle tanımlanamaz, istemci bileşenine geçirilemez, API yanıtında dönemez.
- `createAdminClient()` yalnız sunucu tarafı modüllerde çağrılır.
- Yanlış anahtar (publishable) girildiğinde sistem sessizce yanlış çalışır: okumalar RLS altında boş döner, ilk yazma RLS ihlaliyle patlar. Bu yüzden anahtar biçimi girişte doğrulanır ve adıyla reddedilir.

### 🛡️ Kural 2: Kullanıcı kararı kullanıcının oturumuyla okunur
- Onay, kurtarma, film indirme gibi kullanıcıya ait eylemlerde veri `createClient()` ile, RLS altında okunur. Sahiplik kontrolü koda değil politikaya bırakılır.
- Service role yalnız durum geçişi ve kuyruk yazması gibi sistem işlemlerinde kullanılır; gerekçesi kodda yorumla yazılır.

### 🛡️ Kural 3: IDOR koruması
- Kaynak kimliği URL'den geliyorsa (`runId`, `motionId`) sahiplik mutlaka doğrulanır — RLS ile ya da `.eq("owner_id", user.id)` ile. "Bağlantıyı bilen erişir" kabul edilemez.

### 🛡️ Kural 4: Sağlayıcı anahtarları şifreli durur
- Sağlayıcı API anahtarları AES-256-GCM ile şifrelenir; `provider_credentials` tablosu `anon` ve `authenticated` rolleri için **her şeyi reddeden** politikaya sahiptir.
- Panelde yalnız son 4 hane gösterilir. Anahtar hiçbir ekranda, logda veya olay kaydında açık yazılamaz.
- `PROVIDER_ENC_KEY_V1` kaybedilirse saklanan tüm anahtarlar kalıcı olarak okunamaz hâle gelir.

---

## 2. Girdi ve Çıktı Güvenliği

### 🛡️ Kural 5: Dış girdi şemadan geçmeden kullanılamaz
- HTTP gövdesi ve LLM çıktısı **her zaman** Zod ile doğrulanır. `as` ile tip zorlama doğrulama değildir.
- Mass assignment koruması buradan gelir: şemada olmayan alan sisteme giremez.

### 🛡️ Kural 6: Üretilen HTML'de kaçışlama zorunlu
- Sahne metinleri modelden gelir ve HTML'e gömülür. **Her metin `esc()` üzerinden geçer.** Kaçışlamayı atlamak, üretilen dosyaya script sokabilecek tek yoldur.
- Renk gibi CSS'e giden değerler biçim doğrulamasından geçer (yalnız hex); CSS'e serbest metin geçirilmez.
- Üretilen dosya `content-security-policy: sandbox allow-scripts` ile servis edilir: kendi kaynağında çalışır, panelin oturumuna erişemez.

### 🛡️ Kural 7: SSRF koruması
- Kullanıcının girdiği `base_url` doğrudan çağrılamaz. Özel ağ aralıkları ve yerel adresler engellenir; yerel ağa bakan sağlayıcı `local_worker_only` işaretlenir ve Vercel'den çağrılmaz.

### 🛡️ Kural 8: SQL enjeksiyonu
- Sorgular PostgREST/Supabase istemcisi üzerinden parametreli kurulur. Dinamik string birleştirmeyle SQL üretmek yasaktır. Migration içindeki fonksiyonlarda `search_path` sabitlenir.

---

## 3. Kod Kalitesi ve Sır Yönetimi

### 🛡️ Kural 9: Sıfır derleme hatası
- `npx tsc --noEmit` ve `npx next build` sıfır hata ile tamamlanmadan hiçbir iş `completed` yapılamaz.
- `any` ve `@ts-ignore` yasaktır; gerekiyorsa gerekçesi yorumla yazılır ve Security Reviewer onayı alınır.

### 🛡️ Kural 10: Hardcoded secret yasağı
- Depo **halka açıktır**. Gerçek API anahtarı, şifre, token veya bağlantı dizesi hiçbir dosyaya — dokümanlar dahil — yazılamaz.
- Tüm sırlar ortam değişkeninden okunur; `.env.example` yalnız yer tutucu içerir.
- Dokümana örnek eklenirken gerçek değer değil, biçimi belli yer tutucu kullanılır.

### 🛡️ Kural 11: Hata mesajı sızdırmaz
- Kullanıcıya dönen hata, sorunu çözmesine yetecek kadar açık; sistem içini ifşa etmeyecek kadar kapalı olmalıdır. Yığın izi, tablo adı, anahtar öneki kullanıcıya gösterilmez.

### 🛡️ Kural 12: Sessiz yutma yasağı
- `catch {}` ile yutulan hata yasaktır. Yutulan bir hata, aylarca çalışmayan bir güvenlik ağı demektir — bu projede `requeue_expired_jobs` tam olarak böyle sessiz kaldı.

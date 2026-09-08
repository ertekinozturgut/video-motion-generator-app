# Backend Geliştirme ve Temiz Kod (Clean Code) Kuralları

Bu kural, backend geliştiricilerinin (TypeScript / Next.js 15 / Supabase) kod tabanında uygulayacağı **fonksiyon yönetimi**, **modül tasarımı**, **tip güvenliği** ve **temiz kod** anayasasını belirler. Tüm backend kodları bu kurallara uymak zorundadır.

---

## 📚 Dayandığı Literatür ve Standartlar
- **Clean Code: A Handbook of Agile Software Craftsmanship** (Robert C. Martin)
- **Refactoring: Improving the Design of Existing Code** (Martin Fowler)
- **Code Complete (2nd Edition)** (Steve McConnell)
- **Working Effectively with Legacy Code** (Michael Feathers)
- **Designing Data-Intensive Applications** (Martin Kleppmann)
- **TypeScript Handbook & Effective TypeScript** (Dan Vanderkam)

---

## ⚡ BÖLÜM 1: Fonksiyon Yönetimi (Function Craftsmanship)

### 1. Tek Bir İş Yapma Kuralı
- Bir fonksiyon yalnızca **tek bir iş yapmalı**, onu **mükemmel yapmalı** ve **yalnızca onu yapmalıdır**.
- Bir fonksiyon içinde birden fazla soyutlama seviyesi bulunamaz. (Örn: hem HTTP gövdesi ayrıştırıp, hem prompt kurup, hem de veritabanına yazan fonksiyon yasaktır.)

### 2. Boyut Sınırı: Maksimum 15 - 25 Satır
- Bir fonksiyon dikey kaydırmaya ihtiyaç duymadan tek bakışta anlaşılmalıdır.
- 25 satırı aşan fonksiyonlar SRP ihlalidir; modül içi yardımcı fonksiyonlara bölünmelidir.

### 3. Parametre Sayısı Sınırları
- **İdeal:** 0 veya 1 parametre. **Kabul edilebilir:** 2.
- **🔴 KESİN YASAK:** 3 veya daha fazla konumsal parametre.
  - *Kural:* Üç ve üzeri girdi gerekiyorsa **adlandırılmış tek bir nesne** alınır. Bu projede `enqueue`, `callStructured`, `recordAttempt`, `renderFilm` bu deseni izler.

```ts
// KÖTÜ: 5 konumsal parametre — çağrı yerinde hangisi ne, okunmuyor
function enqueue(ownerId: string, runId: string, motionId: string | null,
                 jobType: JobType, delaySeconds: number): Promise<string>;

// İYİ: niyet belirten tek nesne; alan eklemek imzayı bozmuyor
function enqueue(input: EnqueueInput): Promise<string>;
```

### 4. Bayrak (Boolean) Parametre Yasağı
Bir fonksiyona bayrak geçmek, o fonksiyonun en az iki iş yaptığının kanıtıdır.

```ts
// KÖTÜ:
async function resolveMotion(job: JobRow, skip: boolean): Promise<void>;

// İYİ:
async function retryMotion(job: JobRow): Promise<void>;
async function skipMotion(job: JobRow): Promise<void>;
```

### 5. Komut - Sorgu Ayrımı (CQS)
- Bir fonksiyon ya durumu değiştirir (Command) ya soruya cevap verir (Query). **Asla ikisi birden.**
- *Örnek ihlal:* `loadMotion()` çağrıldığında arka planda `qa_attempt` sayacını artırmak. Gizli yan etki yasaktır.

### 6. Erken Dönüş ve Koruma İfadeleri (Guard Clauses)
- İç içe `if` piramitleri yasaktır. Maksimum girinti seviyesi **2**.

```ts
// KÖTÜ: derinlik 4, okurken kaybolunuyor
async function handle(job: JobRow) {
  if (job.motion_id) {
    const m = await load(job.motion_id);
    if (m) {
      if (m.status === "READY") {
        if (m.motion_plan_json) { /* asıl iş burada, 4 seviye içeride */ }
      }
    }
  }
}

// İYİ: geçersiz durumlar başta elenir, asıl iş dümdüz akar
async function handle(job: JobRow) {
  if (!job.motion_id) throw new Error("motion_id gerekiyor");

  const motion = await loadMotion(job);
  if (motion.status !== "READY") return;
  if (!motion.motion_plan_json) throw new Error("Motion planı yok");

  /* asıl iş */
}
```

### 7. Hata Türünü Ayır: Teknik Arıza vs İçerik Kusuru
- `throw` **yalnız teknik arıza** içindir: veritabanı erişilemiyor, zorunlu kayıt yok, sağlayıcı hata döndü. Bunlar yeniden denemeye değer.
- İçerik kusuru (model şemaya uymuyor, sahne tasarımı kusurlu, denetim reddetti) `throw` edilmez — yeniden deneme aynı sonuca varır, yalnız maliyet ve kayıt üretir. İçerik kusuru insana yönlendirilir.

---

## 🏛️ BÖLÜM 2: Modül Kapsamı ve Tasarımı

### 1. Dosya Boyutu ve Sorumluluk Sınırı
- Maksimum **250 - 300 satır**. Aşan dosya "God module" kokar ve bölünür.
- `utils.ts`, `helpers.ts`, `common.ts`, `manager.ts` gibi torba modüller **yasaktır**. İsim sorumluluğu yansıtır: `lib/render/guard.ts`, `lib/providers/chat.ts`, `lib/jobs/machine.ts`.

### 2. Yüksek Bağdaşıklık (High Cohesion)
- Bir modülün fonksiyonları aynı kavram etrafında toplanmalıdır. İki bağımsız küme oluşuyorsa modül ikiye bölünür.

### 3. Demeter Yasası (En Az Bilgi İlkesi)
- Zincirleme erişim yasaktır:

```ts
// KÖTÜ: çağıran taraf iç yapıyı ezberliyor
const flagged = run.claim_ledger_json.claims.filter(c => c.needs_review).length;

// İYİ: soru sahibine sorulur
const flagged = countFlaggedClaims(run);
```

### 4. Tek Doğru Yer (Single Source of Truth)
- Aynı kural iki yerde yazılamaz. Bir davranışın tek bir tanımı olur:
  - Durum geçişi → `assertRunTransition` / `assertMotionTransition`
  - Sıradaki iş → `nextJobForMotion`
  - Sahne yerleşim kuralları → `checkScene`
  - Model seçimi → `resolveRoute`
- İkinci kopya ilk gün aynıdır, otuzuncu gün farklıdır ve hangisinin doğru olduğunu kimse bilmez.

---

## 🧩 BÖLÜM 3: Tip Güvenliği ve Sözleşmeler

### 1. `any` ve `@ts-ignore` Yasağı
- `any` yasaktır. Bilinmeyen veri `unknown` ile alınır ve şemayla daraltılır.
- `as` ile tip zorlama, doğrulama yerine geçmez. Dış girdi (HTTP gövdesi, LLM çıktısı, veritabanı JSON kolonu) **Zod'dan geçmeden** kullanılamaz.

### 2. Şema Tek Otoritedir
- Bir verinin geçerli olup olmadığı yalnız `lib/schemas` altında tanımlanır. Aynı kontrolü handler içinde elle tekrar yazmak yasaktır.

### 3. Ayrık Birlikler ve Tükenmişlik Kontrolü
- Durum ve tür alanları serbest string değil, birlik tipidir. `switch` blokları tüm dalları kapsar; `default` sessizce yutmaz, açık hata verir.

```ts
switch (job.job_type) {
  case "GEN_ASSETS": return genAssets(job);
  case "GEN_SPEC":   return genSpec(job);
  default:           throw new Error(`Bilinmeyen adım: ${job.job_type}`);
}
```

### 4. Kompozisyon, Kalıtım Değil
- Sırf kod paylaşmak için sınıf hiyerarşisi kurulmaz. Davranışlar saf fonksiyonlar ve açık bağımlılıklarla birleştirilir.

---

## 🧹 BÖLÜM 4: Temiz Kod Temel Değişmezleri

### 1. Niyet Belirten İsimlendirme
- Tek harfli (`x`, `d`) veya anlamsız (`data`, `temp`, `res2`, `obj`) isimler yasaktır. `flaggedClaimIds`, `sceneProblems`, `withinBudget`.

### 2. İzci Kuralı
- Dokunduğun dosyayı bulduğundan temiz bırak: kullanılmayan import, ölü alan, eskimiş yorum temizlenir.

### 3. Yorum: Ne Değil, Neden
- Kodun ne yaptığını tekrar eden yorum yazılmaz; kod kendini anlatacak hâle getirilir.
- Yorum **neden öyle olduğunu** anlatır ve tercihen bir arıza kaydıdır: *"nullable() değil nullish(): modeller boş alanları çoğu zaman hiç yazmıyor, bu 40 iddialık dökümü çöpe atıyordu — canlıda görüldü."*
- Eskimiş yorum aktif zarardır: kodda duran ölü vaat, okuyanı yanlış yöne gönderir.

### 4. Sihirli Değer Yasağı
- `if (status === 2)` yerine tipli sabit. Süre, eşik ve sınır değerleri adlandırılmış sabit olarak tanımlanır ve gerekçesi yazılır.

### 5. DRY & KISS & YAGNI
- Tekrar eden iş kuralı tekilleştirilir.
- Kullanılmayan alan, çağrılmayan iş tipi, doğrulanmayan şema alanı bırakılmaz. Kodda duran ölü vaat (`specGuard ile doğrulanır` diyen ama doğrulamayan bir yorum gibi) ya bağlanır ya silinir.

---

## 🔍 BÖLÜM 5: Backend Temiz Kod Onay Kapısı (10 Madde)

| # | Kontrol Kriteri | Beklenen Standart | İhlal Durumunda |
| :--- | :--- | :--- | :--- |
| **1** | **Fonksiyon uzunluğu** | Maksimum 15 - 25 satır | Böl |
| **2** | **Parametre sayısı** | Maksimum 2 konumsal | Nesneye topla |
| **3** | **Bayrak parametresi** | Yok | İki fonksiyona böl |
| **4** | **Girinti derinliği** | Maksimum 2 | Guard clause ile erken dön |
| **5** | **Dosya sınırı** | Maksimum 250-300 satır; torba modül yok | SRP'ye göre böl |
| **6** | **`any` / `as` ile zorlama** | Yok; dış girdi Zod'dan geçiyor | RED |
| **7** | **Hata türü ayrımı** | İçerik kusuru `throw` edilmiyor | NEEDS_HUMAN'a yönlendir |
| **8** | **Tek doğru yer** | Kural tek yerde tanımlı | Tekilleştir |
| **9** | **Ölü kod / ölü vaat** | Kullanılmayan alan ve eskimiş yorum yok | Bağla ya da sil |
| **10** | **Sıfır derleme hatası** | `tsc --noEmit` + `next build` temiz | RED |

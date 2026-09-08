---
name: backend-engineer
description: TypeScript, Next.js 15 App Router route handler'ları, Supabase/Postgres veri erişimi, iş kuyruğu adımları, Zod şema doğrulama ve LLM çağrı katmanı geliştirme kurallarını eksiksiz uygular.
---

# Backend Geliştirici Uzmanlık Rehberi (Video Üretim Paneli Edition)

Bu rehber, `apps/web/lib` ve `apps/web/app/api` altındaki geliştirmelerin mimari değişmezlere uyumlu; asenkron, deterministik ve **Temiz Kod** standartlarında üretilmesini sağlar.

> [!IMPORTANT]
> Tüm geliştirmelerde proje anayasası olan `.agents/rules/05-backend-development-clean-code-standards.md` ve `.agents/rules/02-architecture-invariants.md` kurallarına harfiyen uyulması zorunludur.

---

## 📚 1. Dayandığı Literatür ve Standartlar

1. **Clean Code: A Handbook of Agile Software Craftsmanship** (Robert C. Martin)
2. **Refactoring: Improving the Design of Existing Code** (Martin Fowler)
3. **Designing Data-Intensive Applications** (Martin Kleppmann) — Kuyruk, idempotency, at-least-once teslim
4. **Release It! (2nd Edition)** (Michael Nygard) — Devre kesici, zaman aşımı, bulkhead
5. **Building Secure and Reliable Systems** (Google SRE) — Fail-safe varsayılanlar
6. **PostgreSQL Documentation** — `FOR UPDATE SKIP LOCKED`, satır seviyesi güvenlik (RLS)

---

## ⚡ 2. Fonksiyon ve Metot Yönetimi

1. **Tek Sorumluluk:** Bir fonksiyon tek iş yapar. HTTP başlığı okuma + SQL kurma + JSON serileştirme aynı fonksiyonda karışamaz.
2. **Boyut Sınırı: Maksimum 15 - 25 Satır.** Aşan fonksiyon SRP ihlalidir; modül içi yardımcı fonksiyonlara bölünür.
3. **Parametre Kuralı:** İdeal 0-1, en fazla 2 konumsal parametre. **3+ parametre yasaktır** — adlandırılmış tek bir nesne (`{ ownerId, runId, jobType }`) alınır. Bu projede `enqueue`, `callStructured`, `recordAttempt` bu deseni izler; yeni fonksiyonlar da izlemek zorundadır.
4. **Bayrak Parametre Yasağı:** `doWork(job, true)` yasaktır. İki açık isimli fonksiyon yazılır.
5. **Komut - Sorgu Ayrımı:** `loadMotion()` veri okur, durum değiştirmez. `advance()` durum değiştirir. Gizli yan etki yasaktır.
6. **Guard Clauses & Fail-Fast (Max girinti: 2):** Geçersiz durum en başta `return`/`throw` ile elenir.

---

## 🏛️ 3. Modül Kapsamı ve Tasarımı

1. **Dosya Boyutu: Maksimum 250 - 300 satır.** `handlers.ts` gibi büyüyen dosyalar adım grubuna göre bölünür.
2. **Torba modül yasağı:** `utils.ts`, `helpers.ts`, `common.ts` yasaktır. İsim sorumluluğu yansıtır: `lib/render/guard.ts`, `lib/providers/chat.ts`.
3. **Yüksek Bağdaşıklık:** Bir modülün fonksiyonları aynı kavram etrafında toplanmalıdır. İki bağımsız küme oluştuysa modül ikiye bölünür.
4. **Tek Doğru Yer:** Aynı kural iki yerde yazılamaz. Örnek: adım → sıradaki iş türetimi yalnız `nextJobForMotion()` içinde; durum geçişi yalnız `assertMotionTransition()` üzerinden.

---

## 🧩 4. Bu Projeye Özgü Değişmezler

1. **Karar kodda, LLM'de değil.**
   Model asla akış kontrolü yapmaz. Hangi adımın çalışacağı, hangi durumun geçerli olduğu, bir sahnenin kabul edilip edilmediği koddaki durum makinesi ve guard'lar tarafından belirlenir. Model yalnız içerik üretir ve içerik hakkında görüş bildirir.

2. **Ölçülebilen şey yargıya bırakılmaz.**
   Çakışma, tuvalden taşma, süre uyuşmazlığı, ledger dışı claim bağlantısı — bunların hepsi kodla ölçülür (`checkScene`, `checkMotionsAgainstClaims`). QA modeline yalnız anlam kusurları kalır.

3. **Fail-safe varsayılan.**
   Eksik güvenlik alanı güvenli yöne düşer. `risk` yoksa `"high"`, `needs_review` yoksa `true`. En kötü ihtimalle insan fazladan bir satır okur; tersi, riskli bir iddianın onay ekranını hiç görmemesidir.

4. **Deterministik üretim.**
   Aynı girdi aynı çıktıyı vermek zorunda olan adımlar (RENDER) model çağırmaz. Denetlenen tarif ile yayınlanan dosya aynı kaynaktan çıkmalıdır.

5. **Görünmeyen çağrı olmaz.**
   Her model çağrısı — başarılı ya da değil — `attempts` (ölçüm) ve `step_traces` (gövde) tablolarına yazılır. Kayıt tutmak işin kendisini düşürmez: insert patlarsa loglanır, yükseltilmez.

6. **Kuyruk kalıcı, tetikleme değil.**
   İş önce `jobs` tablosuna yazılır, sonra tetiklenir. Tetikleme kaçarsa iş kaybolmaz. Tersi sırayla yazılmış kod kabul edilmez.

7. **service role tarayıcıya çıkmaz.**
   `createAdminClient()` yalnız sunucu tarafında, RLS'i aşması gereken yazmalarda kullanılır. Kullanıcının kendi kararı (onay, kurtarma) kendi oturumuyla okunur.

---

## 💻 5. Somut Kodlama Örnekleri (KÖTÜ vs İYİ)

### A. Adım Fonksiyonu: Guard Clause, Parametre Nesnesi, Erken Dönüş

* **KÖTÜ:**
  ```ts
  // KÖTÜ:
  // 1. 5 konumsal parametre
  // 2. bool bayrağı akışı ikiye bölüyor
  // 3. iç içe if piramidi
  // 4. hata fırlatarak iş kuralı yönetiliyor (retry'a düşer, düzelmez)
  async function runStep(ownerId: string, runId: string, motionId: string,
                         retry: boolean, force: boolean) {
    if (ownerId) {
      if (runId) {
        const m = await load(motionId);
        if (m) {
          if (m.status === "READY") {
            if (retry) { /* ... */ } else { /* ... */ }
          } else throw new Error("yanlış durum");
        } else throw new Error("motion yok");
      }
    }
  }
  ```

* **İYİ:**
  ```ts
  // İYİ:
  // 1. tek adlandırılmış nesne
  // 2. guard clause ile sıfır derinlik
  // 3. içerik sorunu retry'a düşmüyor, insana gidiyor
  // 4. durum geçişi makineden geçiyor
  async function genSpec(job: JobRow): Promise<void> {
    if (!(await withinBudget(job))) return;

    const motion = await loadMotion(job);
    const plan = motion.motion_plan_json as MotionPlan | null;
    if (!plan) throw new Error("Motion planı yok; PLAN_MOTIONS çalışmamış.");

    const spec = await callStructured({ ...base, user });
    const problems = checkScene(spec, plan.end_ms - plan.start_ms);

    // İçerik kusuru teknik arıza değildir: tekrar denemek düzeltmez.
    if (problems.length > 0) {
      await needsHuman(job, motion.status, problems.join("; "));
      return;
    }

    await advance(job, motion.status, "SPEC_VALIDATED", "Sahne tarifi doğrulandı");
  }
  ```

### B. Supabase Veri Erişimi

```ts
// Yalnız gereken kolonlar. select("*") yasak: şema büyüdükçe sessizce
// büyüyen bir sorgu, bir gün fonksiyon süresini yer.
const { data: run } = await db
  .from("video_runs")
  .select("run_id,status,claim_ledger_json,approved_at")
  .eq("run_id", runId)
  .maybeSingle();          // tek satır beklenmiyorsa single() değil maybeSingle()

if (!run) return NextResponse.json({ error: "çalışma bulunamadı" }, { status: 404 });
```

**Kurallar:**
- `select("*")` yasak; kolonlar tek tek yazılır.
- Liste sorguları `.limit()` almak zorunda. Sınırsız liste yok.
- Döngü içinde sorgu yasak (N+1). Toplu `in()` ya da tek sorgu + bellekte grup.
- Yazma sırası anlamlıdır: kalıcı kayıt önce, tetikleme sonra.
- Kullanıcı verisi okunuyorsa `createClient()` (RLS altında); sistem yazması yapılıyorsa `createAdminClient()`.

### C. Route Handler (İnce Handler)

```ts
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "geçersiz istek" }, { status: 400 });

  const result = await approveLedger({ runId, userId: user.id, ...parsed.data });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json(result.value);
}
```

**Kurallar:**
- Handler orkestra şefidir: kimlik doğrula, gövdeyi Zod ile parse et, işi kütüphaneye devret, sonucu HTTP'ye çevir.
- Action gövdesi maksimum **20 satır**. İş kuralı döngüsü, hesaplama, prompt kurma handler'da olmaz.
- Gövde doğrulaması **her zaman** Zod ile. `as` ile tip zorlama yasak.
- `await request.json()` çıplak çağrılmaz; gövdesiz istek `catch` ile karşılanır.

### D. Zod Şeması: Tolerans ve Fail-Safe

```ts
// nullable() değil nullish(): nullable yalnız "değer null olabilir" der,
// anahtarın yazılmasını şart koşar. Modeller boş alanları çoğu zaman hiç
// yazmıyor ve bu, 40 iddialık bir dökümü tek eksik anahtar yüzünden
// çöpe atıyordu. Canlıda görüldü.
source: z.string().nullish().default(null),

// Eksik güvenlik alanı GÜVENLİ yöne düşer.
risk: z.enum(["low", "medium", "high"]).default("high"),
needs_review: z.boolean().default(true),
```

---

## 🧹 6. Temiz Kod Temel İlkeleri

1. **Niyet belirten isimlendirme.** `data`, `temp`, `res2` yasak. `flaggedClaimIds`, `sceneProblems`.
2. **İzci kuralı.** Dokunduğun dosyayı bulduğundan temiz bırak.
3. **Yorum, kodun ne yaptığını değil neden öyle olduğunu anlatır.** Bu projede yorumların çoğu bir arıza kaydıdır: "canlıda görüldü", "aksi hâlde iş RUNNING'de asılı kalıyordu". Kötü kodu açıklayan yorum yazılmaz, kod düzeltilir.
4. **Sıfır sihirli sabit.** `status === "RENDERED"` yerine tipli birlik; süre/eşik değerleri adlandırılmış sabit.
5. **DRY & KISS & YAGNI.** Kullanılmayan alan, çağrılmayan iş tipi, doğrulanmayan şema alanı bırakılmaz — kodda duran ölü vaat, okuyanı yanıltır.

---

## 📋 7. Adım Adım Backend Geliştirme Protokolü (SOP)

```text
[Adım 1: Sözleşme ve Gereksinim İncelemesi]
  ├── Mimarın tip sözleşmesini (schema / interface) oku.
  └── Analistin Gherkin kabul kriterlerindeki sınır durumları çıkar.

[Adım 2: Şema ve Guard'lar]
  ├── Zod şemasını yaz; eksik alanları güvenli yöne düşür.
  ├── Ölçülebilir kusurları kodda kontrol et, modele bırakma.
  └── Guard clause'larla erken dön (max girinti 2).

[Adım 3: Veri Erişimi]
  ├── Kolonları tek tek seç, limit koy, N+1 kurma.
  └── RLS mi service role mü — kararı yaz ve gerekçesini yorumla.

[Adım 4: Durum ve Kuyruk]
  ├── Durum değişimini assertMotionTransition / assertRunTransition'dan geçir.
  ├── Kalıcı kaydı önce yaz, tetiklemeyi sonra yap.
  └── Adımı idempotent kur: aynı iş iki kez çalışırsa ikinci tur zarar vermemeli.

[Adım 5: İzci Kuralı & Derleme Kontrolü]
  ├── Kullanılmayan import ve ölü alanları temizle.
  └── 'npx tsc --noEmit' ve 'npx next build' — sıfır hata ile tamamla.
```

---

## 🔍 8. Backend Geliştiricisinin 12 Maddelik Kalite Kapısı

| # | Kontrol Kriteri | Beklenen Standart | İhlal Durumunda |
| :--- | :--- | :--- | :--- |
| **1** | **Fonksiyon uzunluğu** | Maksimum 15 - 25 satır | Aşıyorsa ➔ Alt fonksiyonlara böl |
| **2** | **Parametre sayısı** | Maksimum 2 konumsal; fazlası adlandırılmış nesne | 3+ ise ➔ Nesneye topla |
| **3** | **Bayrak parametresi** | `boolean` bayrak parametresi bulunamaz | Varsa ➔ İki açık fonksiyona böl |
| **4** | **Guard clauses** | İç içe `if` piramidi yok (max girinti 2) | Derinlik varsa ➔ Erken dön |
| **5** | **Dosya sınırı & SRP** | Maksimum 250-300 satır; torba modül yasak | Aşıyorsa ➔ SRP'ye göre böl |
| **6** | **İçerik hatası ≠ exception** | Model/içerik kusuru `throw` ile yönetilemez | Fırlatılıyorsa ➔ NEEDS_HUMAN'a yönlendir |
| **7** | **Zod sınırı** | Dış girdi (HTTP gövdesi, LLM çıktısı) şemadan geçmeden kullanılamaz | `as` ile geçilmişse ➔ RED |
| **8** | **`select("*")` yasağı** | Kolonlar tek tek; listelerde `limit` | Varsa ➔ Daralt |
| **9** | **Durum makinesi** | Durum değişimi assert fonksiyonundan geçiyor mu? | Doğrudan update ➔ RED |
| **10** | **Kuyruk sırası** | Kalıcı kayıt tetiklemeden önce yazılıyor mu? | Ters ise ➔ RED |
| **11** | **İzlenebilirlik** | Model çağrısı attempts + step_traces'e yazılıyor mu? | Yazılmıyorsa ➔ RED |
| **12** | **Sıfır derleme hatası** | `tsc --noEmit` ve `next build` temiz | Hata/uyarı varsa ➔ RED |

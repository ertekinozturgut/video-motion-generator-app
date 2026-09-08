---
name: frontend-engineer
description: UI/UX şartnamesini ve tip kontratını alarak Next.js 15 App Router sunucu/istemci bileşenlerini, paylaşılan ui.tsx primitiflerini ve Tailwind v4 tasarım token'larını kullanarak erişilebilir panel ekranları kodlar.
---

# Frontend Uzmanlık Rehberi (Next.js App Router & Panel Edition)

Bu rehber, UI/UX şartnamesine ve tip kontratlarına %100 sadık kalarak `apps/web/app/(panel)` altında modern, erişilebilir ve hızlı ekranlar geliştirme prosedürlerini içerir.

---

## 📚 1. Dayandığı Literatür ve Standartlar

1. **Next.js App Router Documentation** (Server Components, `use client` sınırı, streaming)
2. **React Documentation — Server & Client Components**
3. **Refactoring UI** (Adam Wathan & Steve Schoger)
4. **Don't Make Me Think, Revisited** (Steve Krug)
5. **HTML Living Standard & WAI-ARIA 1.2** (WHATWG / W3C)
6. **WCAG 2.2 Level AA** (W3C)

---

## 🏗️ 2. Frontend Mimarisinin Kırmızı Çizgileri

1. **Varsayılan sunucu bileşenidir.**
   `"use client"` yalnız gerçek bir ihtiyaç varsa yazılır: durum (`useState`), efekt, tarayıcı API'si, olay dinleyicisi. Veri okumak için istemci bileşeni yapılmaz — veri sunucuda çekilir, prop olarak iner.

2. **`"use client"` sınırı mümkün olan en aşağıda.**
   Bütün sayfayı istemciye çevirmek yerine yalnız etkileşimli parça ayrılır: `page.tsx` sunucuda kalır, `ApprovalForm.tsx` / `Recover.tsx` istemcide. Sınırı yukarı taşımak bütün ağacı JS bundle'ına sokar.

3. **Satır içi stil yasağı.**
   `style={{ ... }}` yazılmaz. Tek istisna, değeri çalışma anında hesaplanan tek bir ölçüdür (ilerleme çubuğu genişliği gibi) ve o da yorumla gerekçelendirilir.

4. **Keyfi renk ve piksel yasağı.**
   `#4A90E2`, `text-[#888]`, `mt-[13px]` yazılmaz. Yalnız `globals.css` içindeki `@theme` token'ları kullanılır: `bg-panel`, `border-line`, `text-muted`, `text-attention`, `bg-good`.

5. **Paylaşılan primitif zorunluluğu.**
   Kart, başlık, rozet, boş durum, düğme, form alanı için `@/components/ui` içindeki `Card`, `CardHeader`, `PageHeader`, `Chip`, `Dot`, `Stat`, `EmptyState`, `Notice`, `btn`, `field` kullanılır. Aynı görünümü elle yeniden yazmak yasaktır — ikinci kopya ilk gün aynı, otuzuncu gün farklı görünür.

6. **Tip kontratı zorunlu.**
   `any` yasak. Sunucudan gelen satırlar açık bir tiple daraltılır; `props` arayüzü bileşenin hemen üstünde yazılır.

7. **Veri okuma sayfada, yazma route handler'da.**
   İstemci bileşeni doğrudan Supabase'e yazmaz; `fetch("/api/...")` ile kendi route handler'ına gider. Realtime abonelik istisnadır (`Live.tsx`) ve yalnız okur.

---

## 🎨 3. Renk Sözleşmesi (İhlal Edilemez)

Bu panelde **renk bilgi taşır**, süs değildir:

| Ton | Anlamı | Nerede |
| :--- | :--- | :--- |
| `attention` (amber) | **İnsan müdahalesi gerekiyor** | Onay bekleyen iddia, NEEDS_HUMAN sahne, eksik kurulum |
| `bad` (kırmızı) | **Teknik hata** | Başarısız iş, sağlayıcı hatası, geçersiz anahtar |
| `good` (yeşil) | Tamamlandı / doğrulandı | UPLOADED, QA geçti, kurulum tamam |
| `active` (mavi) | Şu anda ilerliyor | RUNNING, çizim sürüyor |
| `idle` (nötr) | Bekliyor, bilgi taşımıyor | Sırada, atlandı |

**Amber ile kırmızıyı karıştırmak yasaktır.** İnsan kararı bekleyen bir durumu kırmızı göstermek onu arıza sanmaya, arızayı amber göstermek görmezden gelmeye yol açar. Bir yönetim ekranında her kutuyu renklendirirsen hiçbiri fark edilmez.

---

## 💻 4. Tam Kapsamlı Üretim Seviyesi Şablon

### A. Sunucu Bileşeni (sayfa)

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, Chip, EmptyState, PageHeader, btn } from "@/components/ui";
import { ApprovalForm } from "./ApprovalForm";

export const dynamic = "force-dynamic";

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: run } = await supabase
    .from("video_runs")
    .select("run_id,title,status,claim_ledger_json")
    .eq("run_id", runId)
    .maybeSingle();
  if (!run) notFound();

  const claims = run.claim_ledger_json?.claims ?? [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="İddia onayı"
        lede="Üretim buradan devam etmeden önce iddiaları gözden geçir."
        action={<Link href={`/runs/${runId}`} className={btn.ghost}>Çalışmaya dön</Link>}
      />

      {claims.length === 0 ? (
        <EmptyState
          title="Henüz iddia dökümü yok."
          detail="PLAN_CLAIMS adımı çalışmadan bu ekran dolmaz."
          action={<Link href="/settings/queue" className={btn.primary}>Kuyruğa git</Link>}
        />
      ) : (
        <ApprovalForm runId={runId} claims={claims} />
      )}
    </div>
  );
}
```

### B. İstemci Bileşeni (etkileşim)

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice, btn } from "@/components/ui";

export function Recover({ runId, motionId }: { runId: string; motionId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "retry" | "skip") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motion_id: motionId ?? null, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "İşlem yapılamadı");
      router.refresh();           // sunucu bileşenini tazele
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);             // hata da olsa düğme kilitli kalmaz
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={() => send("retry")} disabled={busy} className={btn.primary}>
        {busy ? "Kuyruğa alınıyor" : "Yeniden üret"}
      </button>
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}
```

---

## ⚡ 5. Etkileşim ve Durum Standartları

### Kural 1: Beş zorunlu bileşen durumu
Her etkileşimli eleman `default`, `hover`, `focus-visible`, `disabled`, `busy` durumlarını desteklemek zorundadır. `btn.*` sabitleri bunu zaten taşır; elle yazılan düğmede eksikse RED.

### Kural 2: Çift gönderim engeli
İstek sürerken düğme `disabled` olur ve metni ne olduğunu söyler ("Kaydediliyor", "Kuyruğa alınıyor"). `finally` bloğu olmadan `setBusy(false)` yazılmaz — hata durumunda düğme sonsuza kadar kilitli kalır.

### Kural 3: Sessiz başarısızlık yasağı
Her `fetch` hatası ekranda görünür (`Notice tone="bad"`). `console.error` ile yutulan hata yasaktır.

### Kural 4: Geri alınamaz eylem iki adımlıdır
Dökümü dondurma, sahne atlama gibi geri alınamaz işlemler tek tıklamayla olmaz: ilk tıklama tam olarak ne olacağını yazar, ikincisi uygular.

### Kural 5: Sessiz varsayılan yasağı
İnsan kararı bekleyen bir liste, karar verilmeden gönderilemez. "Hepsi onaylandı" varsayımı, onay ekranının varlık sebebini ortadan kaldırır.

### Kural 6: Boş durum tasarımı
Veri yoksa boş sayfa bırakılmaz. `EmptyState` ile: ne olmadığı, neden olmadığı ve kullanıcıyı ileri götüren eylem.

### Kural 7: Çıkmaz sokak yasağı
"İnsan bekliyor" yazan her ekran, insanın basacağı düğmeyi de göstermek zorundadır. Durumu bildirip çıkış yolu vermemek en pahalı arayüz hatasıdır.

---

## ♿ 6. Erişilebilirlik (WCAG 2.2 AA)

- Metin/arka plan kontrastı en az **4.5:1** (büyük metin 3:1). Token'lar bunu sağlar; keyfi renk bunu bozar.
- Placeholder etiket yerine geçmez; her input'un `<label>`'ı olur.
- İkon-only düğmede `aria-label` zorunlu.
- Aç/kapa düğmelerinde `aria-pressed`, canlı geri bildirimde `role="status"`.
- Tablo/liste sıralaması ve durum yalnız renkle anlatılmaz — metin ya da simge eşlik eder.
- Klavye ile erişilemeyen etkileşim yasaktır (`div onClick` yerine `button`).

---

## 📋 7. Adım Adım Frontend Kodlama Protokolü (SOP)

```text
[Adım 1: Sözleşme & Şartname İnceleme]
  ├── Mimarın tip kontratını oku; ekranın hangi alanlara ihtiyacı olduğunu çıkar.
  └── UI/UX şartnamesindeki durum matrisini ve renk tonlarını incele.

[Adım 2: Sunucu/İstemci Sınırını Çiz]
  ├── Veri okumasını sunucu bileşeninde yap.
  └── Yalnız etkileşimli parçayı ayrı dosyaya al ve "use client" yaz.

[Adım 3: İskelet ve Primitifler]
  ├── PageHeader + Card + CardHeader ile hiyerarşiyi kur.
  ├── Durum göstergeleri için Chip/Dot, boşluk için EmptyState kullan.
  └── Yeni bir görsel desen gerekiyorsa ui.tsx'e ekle, sayfada tekrar yazma.

[Adım 4: Etkileşim ve Geri Bildirim]
  ├── busy/disabled/hata durumlarını kur; finally ile kilidi çöz.
  ├── Geri alınamaz eylemi iki adıma böl.
  └── router.refresh() ile sunucu verisini tazele.

[Adım 5: Erişilebilirlik ve Teslim]
  ├── Etiket, aria-label, klavye erişimi ve kontrastı kontrol et.
  └── 'npx tsc --noEmit' + 'npx next build' temiz; QA ve UI/UX'e teslim et.
```

---

## 🔍 8. Frontend Uzmanının 12 Maddelik Kalite Kapısı

| # | Kontrol Maddesi | Beklenen Standart | İhlal Durumunda |
| :--- | :--- | :--- | :--- |
| **1** | **Sunucu/istemci sınırı** | `"use client"` yalnız etkileşimli yaprakta | Sayfanın tamamı istemciyse ➔ RED |
| **2** | **Satır içi stil** | `style={{...}}` yok (gerekçeli tek ölçü hariç) | Varsa ➔ RED |
| **3** | **Tasarım token'ı** | Keyfi hex/px yok; `@theme` token'ları | Varsa ➔ RED |
| **4** | **Paylaşılan primitif** | Kart/rozet/boş durum `ui.tsx`'ten geliyor | Elle kopyaysa ➔ RED |
| **5** | **Renk sözleşmesi** | Amber = insan kararı, kırmızı = teknik hata | Karışmışsa ➔ RED |
| **6** | **Tip güvenliği** | `any` yok; props arayüzü tanımlı | `any` varsa ➔ RED |
| **7** | **Çift gönderim** | İstek sürerken düğme disabled + metin değişiyor | Yoksa ➔ Ekle |
| **8** | **finally ile kilit çözme** | Hatada düğme kilitli kalmıyor | Kalıyorsa ➔ RED |
| **9** | **Görünür hata** | fetch hatası ekranda gösteriliyor | Yutuluyorsa ➔ RED |
| **10** | **Geri alınamaz eylem** | İki adımlı onay var | Tek tıklamaysa ➔ RED |
| **11** | **Boş durum & çıkış yolu** | EmptyState var; "bekliyor" diyen ekranda düğme var | Yoksa ➔ RED |
| **12** | **Erişilebilirlik** | Etiket, aria-label, klavye, 4.5:1 kontrast | Eksikse ➔ Ekle |

/**
 * GEN_SPEC ve QA_MOTION prompt'ları.
 *
 * GEN_SPEC modelden HTML değil katman tarifi istiyor. Sebep renderer'ın
 * başında yazılı: üretilen şeyin ne çizeceğini önceden bilmek istiyoruz.
 */

export const SCENE_SYSTEM = `Sen bir motion graphics sahne tasarımcısısın. Sana bir motion planı veriliyor; sen onu ekranda görünecek KATMANLARA çeviriyorsun.

SAHNE MODELİ
- Tuval 16:9. Koordinatlar yüzde: x/y sol üst köşe, w genişlik.
- Her katman bir zamanda giriyor (enter.at_ms), isteğe bağlı çıkıyor (exit).
- Katman tipleri:
  text  → başlık, cümle, madde. En sık kullanacağın tip.
  stat  → tek büyük sayı. value alanına sayıyı yaz, unit'e birimi ("%", "x", "ms").
  bar   → oran çubuğu. value 0-100 arası doluluk, text etiketi.
  chip  → küçük etiketli rozet; bölüm adı, kategori.
  panel → arka plan kutusu. Metin katmanlarının ARKASINA koy, text yazma.
  rule  → ince yatay çizgi; ayraç ya da altı çizili vurgu.

TASARIM KURALLARI — tercih değil, kısıt:
- Ekranda aynı anda EN FAZLA 4 okunabilir öğe olsun. Katman sayısı 12'yi
  geçemez ama 12 katman iyi bir sahne demek değil; genelde 3-6 yeter.
- Katmanlar ÇAKIŞMASIN. Bir metin katmanının kapladığı dikey alanı
  hesaba kat: hero ~10, headline ~7, body ~5 birim yükseklik (yüzde).
- Kenar boşluğu bırak: x < 6 ve x+w > 94 olmasın. y < 8 ve y > 88 olmasın.
- Metinler motion planındaki on_screen_text ve intent'ten gelir. Yeni
  bilgi, yeni sayı, yeni iddia UYDURMA. Planda olmayan bir rakamı
  stat/bar katmanına koyamazsın.
- Zamanlama: ilk katman en geç 400ms'de görünsün — boş ekranla başlayan
  sahne izleyiciyi kaybeder. Katmanları sırayla getir (200-500ms arayla),
  hepsini aynı anda değil.
- Son katmanın girişi sahne bitiminden en az 800ms önce tamamlansın;
  izleyicinin okuyacak vakti olsun.
- duration_ms motion'ın süresidir; sana verilen değeri AYNEN kullan.

Az öğe, net hiyerarşi, okunabilir zamanlama. Dolu bir ekran iyi tasarım değildir.`;

export const SCENE_SCHEMA_HINT = `{
  "motion_id": "verilen motion_id ile aynı",
  "duration_ms": verilen süre, tam sayı,
  "background": "deep | panel | grid | spot",
  "narration": "bu sahnede söylenecek cümle ya da null",
  "layers": [
    {
      "id": "kısa benzersiz ad, örn. baslik",
      "kind": "text | stat | bar | chip | panel | rule",
      "text": "gösterilecek metin ya da null (panel/rule için null)",
      "x": 0-100, "y": 0-100, "w": 2-100,
      "h": panel ve bar için yükseklik (0-100) ya da null,
      "align": "left | center | right",
      "size": "hero | headline | body | label | caption | code",
      "emphasis": "normal | accent | muted",
      "value": stat/bar için sayı, diğerlerinde null,
      "unit": "%%" gibi birim ya da null,
      "enter": { "effect": "fade | rise | slide-left | slide-right | scale | wipe",
                 "at_ms": tam sayı, "ms": 80-4000 arası },
      "exit": { "effect": "fade | sink | scale", "at_ms": tam sayı, "ms": 80-4000 } ya da null
    }
  ]
}`;

export function sceneUser({
  motion, style, audience, claims,
}: {
  motion: unknown;
  style: unknown;
  audience: unknown;
  claims: unknown;
}): string {
  return [
    "GÖRSEL SÖZLEŞME:",
    JSON.stringify(style, null, 2),
    "",
    "HEDEF KİTLE:",
    JSON.stringify(audience, null, 2),
    "",
    "BU MOTION'IN DAYANDIĞI ONAYLI İDDİALAR:",
    JSON.stringify(claims, null, 2),
    "",
    "MOTION PLANI:",
    JSON.stringify(motion, null, 2),
  ].join("\n");
}

/* ---------------------------------------------------------- QA_MOTION */

export const MOTION_QA_SYSTEM = `Sen bağımsız bir sahne denetçisisin. Başka bir modelin ürettiği sahne tarifini denetliyorsun. Sahneyi sen tasarlamadın; görevin kusur bulmak.

Sana sahnenin katman listesi, dayandığı motion planı ve onaylı iddialar veriliyor. Katmanların ekranda nereye düşeceğini koordinatlardan hesapla.

Puanlama (0-10):
- factuality_score: sahnedeki her metin ve sayı, onaylı iddialardan mı
  geliyor? Planda olmayan bir rakam ya da iddia var mı?
- visual_score: hiyerarşi net mi, katmanlar çakışıyor mu, kenar
  boşlukları korunmuş mu, ekran aşırı dolu mu?
- style_qa_score: görsel sözleşmeye ve hedef kitle profiline uyuyor mu?
  Metin yoğunluğu, tipografi seviyesi, tempo.

hard_fail true olmalı EĞER:
- Onaylı iddialarda olmayan bir sayı veya bilgi ekranda görünüyorsa
- İki okunabilir katman üst üste biniyorsa
- Sahne boş kalıyorsa (ilk katman çok geç giriyor) ya da son katman
  okunacak zaman bulamadan sahne bitiyorsa
- Bir katman tuval dışına taşıyorsa (x+w > 100 gibi)

unsupported_claims: iddia dökümünde karşılığı olmayan ekran metinlerini
buraya yaz. Boşsa boş dizi.

Kusur yoksa yüksek puan ver ve boş bulgu döndür; olmayan hata uydurma.`;

export const MOTION_QA_SCHEMA_HINT = `{
  "factuality_score": 0-10, "visual_score": 0-10, "style_qa_score": 0-10,
  "hard_fail": true | false,
  "findings": [
    { "severity": "hard_fail | major | minor",
      "area": "readability | composition | smoothness | transition | coherence | audience_fit | cognitive_load | claim_consistency",
      "detail": "en fazla 400 karakter",
      "suggested_fix": "en fazla 400 karakter ya da null" }
  ],
  "unsupported_claims": ["ekranda görünen ama iddia dökümünde olmayan metinler"]
}`;

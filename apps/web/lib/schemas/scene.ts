import { z } from "zod";

/**
 * SAHNE — bir motion'ın izlenebilir hâli.
 *
 * Modelden HTML/CSS istemiyoruz. İstenseydi çıktının ne render edeceğini
 * önceden bilemezdik: bozuk etiket, dış kaynak, script, okunamayacak
 * kadar küçük yazı. Bunun yerine model KATMAN tarif ediyor; HTML'i kod
 * üretiyor (lib/render/scene.ts). Böylece:
 *   - metin kaçışlanıyor, enjeksiyon yüzeyi yok
 *   - tipografi tokenlarla sınırlı, görsel sözleşmenin altına düşemiyor
 *   - her sahne aynı sahne boyutunda, aynı zaman ekseninde çalışıyor
 *
 * Koordinatlar yüzde: sahne 1920x1080 ama ölçekleniyor, yüzde bundan
 * bağımsız kalıyor.
 */

const ENTER_EFFECTS = ["fade", "rise", "slide-left", "slide-right", "scale", "wipe"] as const;
const EXIT_EFFECTS = ["fade", "sink", "scale"] as const;

export const EnterSchema = z.object({
  effect: z.enum(ENTER_EFFECTS).default("fade"),
  /** Sahne başlangıcına göre milisaniye. */
  at_ms: z.number().int().nonnegative().default(0),
  ms: z.number().int().min(80).max(4000).default(500),
});

export const ExitSchema = z.object({
  effect: z.enum(EXIT_EFFECTS).default("fade"),
  at_ms: z.number().int().nonnegative(),
  ms: z.number().int().min(80).max(4000).default(400),
});

/**
 * Katman tipleri bilinçli olarak az: her tipin nasıl çizileceği kodda
 * yazılı. Yeni bir tip eklemek renderer'a dokunmayı gerektiriyor — bu
 * bir kısıt değil, güvence: model olmayan bir tip uyduramıyor.
 */
export const LayerSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(["text", "panel", "bar", "stat", "rule", "chip"]),

  /** text/chip/stat için gövde; panel ve rule için null. */
  text: z.string().max(240).nullish().default(null),

  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(2).max(100).default(40),
  /**
   * Yalnız panel yüksekliği kullanıyor; diğer tipler içeriğe göre
   * ölçekleniyor. Alt sınır düşük tutuldu: model ince bir ayraç için
   * 0.4 gibi bir değer yazdığında sahnenin tamamı reddedilmesin.
   */
  h: z.number().min(0.2).max(100).nullish().default(null),

  align: z.enum(["left", "center", "right"]).default("left"),
  size: z.enum(["hero", "headline", "body", "label", "caption", "code"]).default("body"),
  emphasis: z.enum(["normal", "accent", "muted"]).default("normal"),

  /** bar: 0-100 doluluk. stat: sayılacak hedef değer. */
  value: z.number().nullish().default(null),
  unit: z.string().max(12).nullish().default(null),

  enter: EnterSchema.default({ effect: "fade", at_ms: 0, ms: 500 }),
  exit: ExitSchema.nullish().default(null),
});
export type Layer = z.infer<typeof LayerSchema>;

export const SceneSpecSchema = z
  .object({
    motion_id: z.string().min(1).max(40),
    duration_ms: z.number().int().min(400).max(60_000),
    background: z.enum(["deep", "panel", "grid", "spot"]).default("deep"),
    /**
     * Katman üst sınırı bir tasarım kararı: aynı anda on iki şey okunmaz.
     * Model daha fazlasını isterse plan çok yüklü demektir, sahne değil.
     */
    layers: z.array(LayerSchema).min(1).max(12),
    /** Seslendirme metni; şimdilik yalnız kayıt ve altyazı için. */
    narration: z.string().max(800).nullish().default(null),
  })
  .refine((s) => s.layers.every((l) => l.enter.at_ms < s.duration_ms), {
    message: "Bir katman sahne bittikten sonra giriyor",
    path: ["layers"],
  });
export type SceneSpec = z.infer<typeof SceneSpecSchema>;

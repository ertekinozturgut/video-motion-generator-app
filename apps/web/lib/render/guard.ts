import type { SceneSpec, Layer } from "@/lib/schemas/scene";

/**
 * Sahnenin mekanik kusurlarını KODLA yakalar.
 *
 * QA modeli bu işi de yapabilir ama yapıp yapmadığından emin olamayız.
 * Çakışan iki kutu, tuvalden taşan bir metin, boş açılan bir sahne —
 * bunlar görüş meselesi değil, ölçülebilir. Ölçülebileni yargıya
 * bırakmıyoruz; QA modeline anlam kusurları kalıyor.
 */

/** Katmanın kapladığı dikey alanın yüzde tahmini. Tipografi ölçeğiyle uyumlu. */
const HEIGHT_PCT: Record<Layer["size"], number> = {
  hero: 11, headline: 7.5, body: 5, label: 4, caption: 3.5, code: 4.5,
};

const READABLE: Layer["kind"][] = ["text", "stat", "bar", "chip"];

export function checkScene(spec: SceneSpec, expectedDurationMs: number): string[] {
  const problems: string[] = [];

  if (Math.abs(spec.duration_ms - expectedDurationMs) > 250) {
    problems.push(
      `süre planla uyuşmuyor: sahne ${spec.duration_ms}ms, plan ${expectedDurationMs}ms`
    );
  }

  const boxes = spec.layers.map((l) => ({ l, box: boxOf(l) }));

  for (const { l, box } of boxes) {
    if (box.x + box.w > 100.5) problems.push(`${l.id} sağdan taşıyor (x+w=${(box.x + box.w).toFixed(1)})`);
    if (box.y + box.h > 100.5) problems.push(`${l.id} alttan taşıyor (y+h=${(box.y + box.h).toFixed(1)})`);
    if ((l.kind === "bar" || l.kind === "stat") && l.value == null) {
      problems.push(`${l.id} bir ${l.kind} ama value alanı boş`);
    }
    if (READABLE.includes(l.kind) && !l.text && l.kind !== "stat") {
      problems.push(`${l.id} metin katmanı ama text boş`);
    }
  }

  // Yalnız aynı anda ekranda olan okunabilir katmanlar çakışabilir.
  // Panel'in altında metin olması tasarım; iki başlığın üst üste binmesi hata.
  const readable = boxes.filter((b) => READABLE.includes(b.l.kind));
  for (let i = 0; i < readable.length; i++) {
    for (let j = i + 1; j < readable.length; j++) {
      const a = readable[i], b = readable[j];
      if (!overlapsInTime(a.l, b.l, spec.duration_ms)) continue;
      if (!overlapsInSpace(a.box, b.box)) continue;
      problems.push(`${a.l.id} ile ${b.l.id} ekranda üst üste biniyor`);
    }
  }

  const firstIn = Math.min(...spec.layers.map((l) => l.enter.at_ms));
  if (firstIn > 700) problems.push(`sahne ${firstIn}ms boyunca boş açılıyor`);

  const lastSettled = Math.max(...spec.layers.map((l) => l.enter.at_ms + l.enter.ms));
  if (lastSettled > spec.duration_ms - 600) {
    problems.push("son katman okunacak zaman bulamadan sahne bitiyor");
  }

  return problems;
}

function boxOf(l: Layer) {
  const h = l.h ?? HEIGHT_PCT[l.size] * (l.kind === "bar" ? 1.8 : 1);
  return { x: l.x, y: l.y, w: l.w, h };
}

function overlapsInSpace(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  // Küçük bir tolerans: bitişik yerleşim çakışma sayılmasın.
  const pad = 0.5;
  return (
    a.x < b.x + b.w - pad && b.x < a.x + a.w - pad &&
    a.y < b.y + b.h - pad && b.y < a.y + a.h - pad
  );
}

function overlapsInTime(a: Layer, b: Layer, duration: number): boolean {
  const span = (l: Layer): [number, number] => [
    l.enter.at_ms,
    l.exit ? l.exit.at_ms + l.exit.ms : duration,
  ];
  const [a0, a1] = span(a);
  const [b0, b1] = span(b);
  return a0 < b1 && b0 < a1;
}

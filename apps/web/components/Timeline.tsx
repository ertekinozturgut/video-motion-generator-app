"use client";

import { MOTION_LABEL, MOTION_TONE, TONE_BG, timecode } from "./status";

export interface TimelineMotion {
  motion_id: string;
  motion_index: number;
  name: string | null;
  start_ms: number;
  end_ms: number;
  status: string;
}

/**
 * Motion'lar kart ızgarası değil, gerçek süreleriyle orantılı bir şerit.
 * Bir motion zaten videodaki bir zaman aralığı; onu eşit kutulara bölmek
 * en çok bilgi taşıyan boyutu atıyor. Boşluklar ve uzun/kısa motion'lar
 * burada doğrudan görünür.
 */
export function Timeline({
  motions,
  selectedId,
  onSelect,
}: {
  motions: TimelineMotion[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  if (motions.length === 0) {
    return (
      <div className="rounded border border-line bg-panel p-6 text-sm text-muted">
        Motion planı henüz üretilmedi.
      </div>
    );
  }

  const total = Math.max(...motions.map((m) => m.end_ms));

  return (
    <div>
      <div className="flex h-14 w-full gap-px overflow-hidden rounded border border-line bg-line">
        {motions.map((m) => {
          const tone = MOTION_TONE[m.status] ?? "idle";
          const width = ((m.end_ms - m.start_ms) / total) * 100;
          const selected = m.motion_id === selectedId;
          return (
            <button
              key={m.motion_id}
              type="button"
              onClick={() => onSelect?.(m.motion_id)}
              style={{ width: `${width}%` }}
              aria-label={`${m.name ?? `Motion ${m.motion_index + 1}`} — ${MOTION_LABEL[m.status] ?? m.status}`}
              className={`group relative min-w-[6px] bg-raised transition-colors hover:bg-line ${
                selected ? "ring-1 ring-inset ring-text" : ""
              }`}
            >
              <span
                className={`absolute inset-x-0 bottom-0 h-1.5 ${TONE_BG[tone]}`}
                aria-hidden
              />
              <span className="tnum block truncate px-1.5 pt-2 text-left text-[11px] text-muted">
                {String(m.motion_index + 1).padStart(2, "0")}
              </span>
            </button>
          );
        })}
      </div>
      <div className="tnum mt-1.5 flex justify-between text-[11px] text-muted">
        <span>{timecode(0)}</span>
        <span>{timecode(total)}</span>
      </div>
    </div>
  );
}

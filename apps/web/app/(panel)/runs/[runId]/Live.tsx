"use client";

import Link from "next/link";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Timeline, type TimelineMotion } from "@/components/Timeline";
import {
  MOTION_LABEL, MOTION_TONE, RUN_LABEL, RUN_TONE, TONE_BG, TONE_TEXT, timecode,
} from "@/components/status";

interface EventRow {
  event_id: number;
  event_type: string;
  prev_state: string | null;
  new_state: string | null;
  message: string | null;
  created_at: string;
}

/**
 * Realtime abonelik. Panel polling yapmaz — motions ve events tabloları
 * publication'da, değişiklikler WebSocket üzerinden gelir.
 */
export function Live({
  runId,
  initialStatus,
  initialMotions,
  initialEvents,
}: {
  runId: string;
  initialStatus: string;
  initialMotions: TimelineMotion[];
  initialEvents: EventRow[];
}) {
  const [status, setStatus] = useState(initialStatus);
  const [motions, setMotions] = useState(initialMotions);
  const [events, setEvents] = useState(initialEvents);
  const [selected, setSelected] = useState<string | undefined>();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`run:${runId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "motions", filter: `run_id=eq.${runId}` },
        (payload) => {
          const row = payload.new as TimelineMotion;
          setMotions((prev) => {
            const i = prev.findIndex((m) => m.motion_id === row.motion_id);
            if (i === -1) return [...prev, row].sort((a, b) => a.motion_index - b.motion_index);
            const next = [...prev];
            next[i] = { ...next[i], ...row };
            return next;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "video_runs", filter: `run_id=eq.${runId}` },
        (payload) => setStatus((payload.new as { status: string }).status)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events", filter: `run_id=eq.${runId}` },
        (payload) => setEvents((prev) => [payload.new as EventRow, ...prev].slice(0, 60))
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [runId]);

  const done = motions.filter((m) => m.status === "UPLOADED").length;
  const attention = motions.filter(
    (m) => MOTION_TONE[m.status] === "attention" || MOTION_TONE[m.status] === "bad"
  );
  const current = motions.find((m) => m.motion_id === selected);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className={`text-lg font-medium ${TONE_TEXT[RUN_TONE[status] ?? "idle"]}`}>
          {RUN_LABEL[status] ?? status}
        </span>
        <span className="tnum text-sm text-muted">
          {done} / {motions.length} motion yüklendi
        </span>
      </div>

      {status === "AWAITING_APPROVAL" && (
        <div className="rounded-lg border border-attention/40 bg-attention/10 p-4">
          <p className="text-sm">
            Doğruluğundan emin olunmayan bilgiler işaretlendi. Üretim, sen
            bunları gözden geçirene kadar duruyor.
          </p>
          <Link
            href={`/runs/${runId}/approval`}
            className="mt-3 inline-flex items-center justify-center rounded-md bg-text px-4 py-2 text-sm font-medium text-ink"
          >
            İddiaları incele
          </Link>
        </div>
      )}

      <Timeline motions={motions} selectedId={selected} onSelect={setSelected} />

      {current && (
        <div className="rounded border border-line bg-panel p-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-medium">{current.name ?? `Motion ${current.motion_index + 1}`}</span>
            <span className="tnum text-sm text-muted">
              {timecode(current.start_ms)} – {timecode(current.end_ms)}
            </span>
            <span className={`text-sm ${TONE_TEXT[MOTION_TONE[current.status] ?? "idle"]}`}>
              {MOTION_LABEL[current.status] ?? current.status}
            </span>
          </div>
        </div>
      )}

      {attention.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-attention">Bekleyen motion&apos;lar</h2>
          <ul className="divide-y divide-line rounded border border-line bg-panel">
            {attention.map((m) => (
              <li key={m.motion_id} className="flex items-baseline gap-4 px-4 py-2.5 text-sm">
                <span className="tnum text-muted">
                  {String(m.motion_index + 1).padStart(2, "0")}
                </span>
                <span className="flex-1">{m.name}</span>
                <span className={TONE_TEXT[MOTION_TONE[m.status] ?? "idle"]}>
                  {MOTION_LABEL[m.status] ?? m.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Akış</h2>
        <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-2">
          {events.map((e) => (
            <li key={e.event_id} className="flex gap-3 text-sm">
              <span className="tnum shrink-0 text-muted">
                {new Date(e.created_at).toLocaleTimeString("tr-TR", {
                  hour: "2-digit", minute: "2-digit", second: "2-digit",
                })}
              </span>
              <span
                className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                  TONE_BG[
                    (e.new_state && (RUN_TONE[e.new_state] ?? MOTION_TONE[e.new_state])) ?? "idle"
                  ]
                }`}
                aria-hidden
              />
              <span className="text-muted">
                {e.message ??
                  (e.new_state
                    ? `${e.prev_state ?? "—"} → ${
                        RUN_LABEL[e.new_state] ?? MOTION_LABEL[e.new_state] ?? e.new_state
                      }`
                    : e.event_type)}
              </span>
            </li>
          ))}
          {events.length === 0 && <li className="text-sm text-muted">Henüz olay yok.</li>}
        </ul>
      </section>
    </div>
  );
}

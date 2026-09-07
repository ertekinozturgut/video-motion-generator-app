"use client";

import { useMemo, useState } from "react";
import {
  Card, CardHeader, Chip, Dot, EmptyState, Mono, btn, field, type Tone,
} from "@/components/ui";
import { CopyButtonClient } from "@/components/CopyButtonClient";
import { MOTION_LABEL, RUN_LABEL, RUN_TONE, MOTION_TONE } from "@/components/status";

export interface TraceRow {
  trace_id: string;
  step: string;
  provider_label: string | null;
  model_key: string | null;
  motion_id: string | null;
  created_at: string;
  request_json: unknown;
  response_text: string | null;
  response_json: unknown;
  usage_json: unknown;
  error_text: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  result: string | null;
  fallback_index: number | null;
  json_mode_tier: string | null;
  schema_repair_count: number | null;
}

export interface EventRow {
  event_id: number;
  event_type: string;
  prev_state: string | null;
  new_state: string | null;
  message: string | null;
  metadata_json: Record<string, unknown> | null;
  motion_id: string | null;
  created_at: string;
}

export interface ArtifactRow {
  artifact_id: string;
  artifact_type: string;
  storage_path: string | null;
  local_path: string | null;
  gdrive_id: string | null;
  bytes: number | null;
  metadata_json: Record<string, unknown> | null;
  motion_id: string | null;
  created_at: string;
}

type Tab = "ai" | "akis" | "dosya";

export function LogViewer({
  traces, events, artifacts,
}: {
  traces: TraceRow[];
  events: EventRow[];
  artifacts: ArtifactRow[];
}) {
  const [tab, setTab] = useState<Tab>(traces.length ? "ai" : "akis");
  const [query, setQuery] = useState("");

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "ai", label: "AI çağrıları", count: traces.length },
    { id: "akis", label: "Akış", count: events.length },
    { id: "dosya", label: "Üretilenler", count: artifacts.length },
  ];

  // Toplamlar başlıkta dursun: "bu çalışma bana kaça patladı" sorusu
  // her zaman ilk sorulan.
  const totals = useMemo(() => {
    let input = 0, output = 0, cost = 0, ms = 0;
    for (const t of traces) {
      input += t.input_tokens ?? 0;
      output += t.output_tokens ?? 0;
      cost += Number(t.cost_usd ?? 0);
      ms += t.latency_ms ?? 0;
    }
    return { input, output, cost, ms };
  }, [traces]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-line bg-panel px-4 py-3 text-sm">
        <span className="tnum">
          {totals.input.toLocaleString("tr-TR")} giriş / {totals.output.toLocaleString("tr-TR")} çıkış token
        </span>
        <span className="tnum text-muted">${totals.cost.toFixed(4)}</span>
        <span className="tnum text-muted">{(totals.ms / 1000).toFixed(1)} sn model süresi</span>
        <span className="tnum ml-auto text-muted">{traces.length} çağrı</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === t.id ? "bg-raised text-text" : "text-muted hover:text-text"
            }`}
          >
            {t.label}
            <span className="tnum ml-1.5 text-xs text-muted">{t.count}</span>
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Kayıtlarda ara"
          aria-label="Kayıtlarda ara"
          className={`${field} ml-auto max-w-56`}
        />
      </div>

      {tab === "ai" && <AiCalls traces={traces} query={query} />}
      {tab === "akis" && <Flow events={events} query={query} />}
      {tab === "dosya" && <Artifacts artifacts={artifacts} query={query} />}
    </div>
  );
}

/* ------------------------------------------------------------------ AI */

function AiCalls({ traces, query }: { traces: TraceRow[]; query: string }) {
  const visible = traces.filter((t) => matches(query, [t.step, t.model_key, t.provider_label, t.response_text]));

  if (traces.length === 0) {
    return (
      <EmptyState
        title="Henüz bir AI çağrısı kaydedilmedi."
        detail="Bu çalışmada henüz model çağrısı yapılmadı. Adım çalıştığında gönderilen prompt, dönen yanıt, token sayacı ve maliyet burada tek tek görünür — başarısız denemeler dahil."
      />
    );
  }
  if (visible.length === 0) {
    return <EmptyState title="Aramaya uyan çağrı yok." />;
  }

  return (
    <ul className="space-y-3">
      {visible.map((t) => (
        <TraceItem key={t.trace_id} trace={t} />
      ))}
    </ul>
  );
}

function TraceItem({ trace: t }: { trace: TraceRow }) {
  const [open, setOpen] = useState(false);
  const tone: Tone = t.error_text || t.result === "provider_error" ? "bad"
    : t.result === "schema_fail" ? "attention"
    : t.result === "ok" ? "good" : "idle";

  const request = pretty(t.request_json);
  const response = t.response_json ? pretty(t.response_json) : (t.response_text ?? "");
  const usage = pretty(t.usage_json);

  return (
    <Card>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3.5 text-left transition-colors hover:bg-raised/50"
      >
        <Dot tone={tone} />
        <span className="text-sm font-medium">{t.step}</span>
        {t.model_key && <span className="text-sm text-muted">{t.model_key}</span>}
        {t.fallback_index ? <Chip tone="attention">yedek {t.fallback_index}</Chip> : null}
        {t.schema_repair_count ? <Chip tone="attention">{t.schema_repair_count} şema onarımı</Chip> : null}
        <span className="tnum ml-auto flex flex-wrap gap-x-3 text-sm text-muted">
          {t.input_tokens != null && <span>{t.input_tokens.toLocaleString("tr-TR")} ↓</span>}
          {t.output_tokens != null && <span>{t.output_tokens.toLocaleString("tr-TR")} ↑</span>}
          {t.cost_usd != null && <span>${Number(t.cost_usd).toFixed(4)}</span>}
          {t.latency_ms != null && <span>{t.latency_ms} ms</span>}
          <span>{new Date(t.created_at).toLocaleTimeString("tr-TR")}</span>
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-line px-5 py-4">
          {t.error_text && (
            <Section title="Hata" value={t.error_text}>
              <Mono>{t.error_text}</Mono>
            </Section>
          )}
          {request && (
            <Section title="Gönderilen" value={request}>
              <Mono>{request}</Mono>
            </Section>
          )}
          {response && (
            <Section title="Dönen" value={response}>
              <Mono>{response}</Mono>
            </Section>
          )}
          {usage && (
            <Section title="Token kullanımı" value={usage}>
              <Mono>{usage}</Mono>
            </Section>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {t.provider_label && <span>sağlayıcı: {t.provider_label}</span>}
            {t.json_mode_tier && <span>şema kademesi: {t.json_mode_tier}</span>}
            {t.result && <span>sonuç: {t.result}</span>}
            {t.motion_id && <span className="tnum">motion: {t.motion_id.slice(0, 8)}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

function Section({ title, value, children }: { title: string; value: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-muted">{title}</span>
        <CopyButtonClient value={value} label="Kopyala" />
      </div>
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- akış */

function Flow({ events, query }: { events: EventRow[]; query: string }) {
  const visible = events.filter((e) =>
    matches(query, [e.event_type, e.message, e.prev_state, e.new_state])
  );

  if (events.length === 0) return <EmptyState title="Henüz olay kaydedilmedi." />;
  if (visible.length === 0) return <EmptyState title="Aramaya uyan olay yok." />;

  const asText = visible
    .map((e) => `${e.created_at}\t${e.event_type}\t${e.prev_state ?? ""}→${e.new_state ?? ""}\t${e.message ?? ""}`)
    .join("\n");

  return (
    <Card>
      <CardHeader
        title="Akış"
        hint="Durum geçişleri ve iş yaşam döngüsü."
        action={<CopyButtonClient value={asText} label="Tümünü kopyala" />}
      />
      <ul className="divide-y divide-line">
        {visible.map((e) => (
          <EventItem key={e.event_id} event={e} />
        ))}
      </ul>
    </Card>
  );
}

function EventItem({ event: e }: { event: EventRow }) {
  const [open, setOpen] = useState(false);
  const meta = e.metadata_json && Object.keys(e.metadata_json).length ? pretty(e.metadata_json) : "";
  const tone: Tone =
    e.event_type === "job_failed" ? "bad"
    : e.event_type === "job_started" ? "active"
    : e.new_state
      ? ((RUN_TONE[e.new_state] ?? MOTION_TONE[e.new_state] ?? "idle") as Tone)
      : "idle";

  return (
    <li className="px-5 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="tnum shrink-0 text-muted">
          {new Date(e.created_at).toLocaleTimeString("tr-TR", {
            hour: "2-digit", minute: "2-digit", second: "2-digit",
          })}
        </span>
        <span className="mt-1.5"><Dot tone={tone} /></span>
        <span className="flex-1">
          {e.message ??
            (e.new_state
              ? `${e.prev_state ?? "—"} → ${RUN_LABEL[e.new_state] ?? MOTION_LABEL[e.new_state] ?? e.new_state}`
              : e.event_type)}
        </span>
        {meta && (
          <button onClick={() => setOpen((o) => !o)} className={btn.quiet}>
            {open ? "gizle" : "ayrıntı"}
          </button>
        )}
      </div>
      {open && meta && (
        <div className="mt-2">
          <div className="mb-1.5 flex justify-end">
            <CopyButtonClient value={meta} label="Kopyala" />
          </div>
          <Mono>{meta}</Mono>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------- dosyalar */

function Artifacts({ artifacts, query }: { artifacts: ArtifactRow[]; query: string }) {
  const visible = artifacts.filter((a) =>
    matches(query, [a.artifact_type, a.storage_path, a.local_path])
  );

  if (artifacts.length === 0) {
    return (
      <EmptyState
        title="Henüz dosya üretilmedi."
        detail="Görsel üretimi ve render adımları henüz taklit ediliyor. Gerçek çıktılar geldiğinde üretilen her görsel, contact sheet ve video burada listelenecek."
      />
    );
  }
  if (visible.length === 0) return <EmptyState title="Aramaya uyan dosya yok." />;

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {visible.map((a) => {
        const path = a.storage_path ?? a.local_path ?? a.gdrive_id ?? "";
        return (
          <Card key={a.artifact_id}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <Chip>{a.artifact_type}</Chip>
              {a.bytes != null && (
                <span className="tnum text-sm text-muted">{formatBytes(a.bytes)}</span>
              )}
              <span className="tnum ml-auto text-xs text-muted">
                {new Date(a.created_at).toLocaleString("tr-TR")}
              </span>
            </div>
            {path && (
              <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
                <span className="tnum flex-1 truncate text-xs text-muted">{path}</span>
                <CopyButtonClient value={path} label="Yolu kopyala" />
              </div>
            )}
          </Card>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------- yardımcı */

function matches(query: string, fields: Array<string | null | undefined>): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(q));
}

function pretty(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

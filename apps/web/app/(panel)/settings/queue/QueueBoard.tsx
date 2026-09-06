"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Card, CardHeader, Chip, Dot, EmptyState, Notice, Stat, btn, type Tone,
} from "@/components/ui";

export interface QueueJob {
  job_id: string;
  job_type: string;
  status: string;
  attempt: number;
  max_attempts: number;
  scheduled_for: string;
  lease_until: string | null;
  last_error: string | null;
  run_id: string;
  created_at: string;
  updated_at: string;
}

const TONE: Record<string, Tone> = {
  QUEUED: "idle", RUNNING: "active", DONE: "good",
  FAILED: "bad", CANCELLED: "idle",
};

const LABEL: Record<string, string> = {
  QUEUED: "Sırada", RUNNING: "Çalışıyor", DONE: "Bitti",
  FAILED: "Başarısız", CANCELLED: "İptal",
};

const FILTERS = ["Tümü", "QUEUED", "RUNNING", "FAILED", "DONE", "CANCELLED"];

export function QueueBoard({
  counts, jobs,
}: {
  counts: Record<string, number>;
  jobs: QueueJob[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("Tümü");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);

  const visible = useMemo(
    () => (filter === "Tümü" ? jobs : jobs.filter((j) => j.status === filter)),
    [jobs, filter]
  );

  // Lease'i geçmiş RUNNING işler kilitlenmiş demektir; cron onları toplar
  // ama beklemek istemeyen admin elle tetikleyebilsin.
  const stuck = jobs.filter(
    (j) => j.status === "RUNNING" && j.lease_until && new Date(j.lease_until) < new Date()
  ).length;

  async function act(action: string, jobId?: string) {
    setBusy(jobId ?? action);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, job_id: jobId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "İşlem başarısız");
      setNotice({
        tone: "good",
        text:
          action === "requeue_expired"
            ? `${json.requeued} iş kuyruğa geri alındı`
            : action === "process"
              ? `${json.claimed} iş alındı, ${json.done} tamamlandı${json.failed ? `, ${json.failed} başarısız` : ""}`
            : action === "retry"
              ? "İş yeniden kuyruğa alındı"
              : "İş iptal edildi",
      });
      router.refresh();
    } catch (e) {
      setNotice({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Sırada" value={counts.QUEUED ?? 0} tone={counts.QUEUED ? "attention" : "idle"} />
        <Stat
          label="Çalışıyor" value={counts.RUNNING ?? 0}
          sub={stuck ? `${stuck} tanesinin lease'i dolmuş` : undefined}
          tone={stuck ? "bad" : counts.RUNNING ? "active" : "idle"}
        />
        <Stat label="Başarısız" value={counts.FAILED ?? 0} tone={counts.FAILED ? "bad" : "good"} />
        <Stat label="Bitti" value={counts.DONE ?? 0} tone="good" />
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <Card>
        <CardHeader
          title="İşler"
          hint="Son 80 kayıt, yeniden eskiye."
          action={
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => act("process")}
                disabled={busy !== null || !(counts.QUEUED ?? 0)}
                className={btn.primary}
              >
                {busy === "process" ? "İşleniyor" : "Sıradakileri işle"}
              </button>
              <button
                onClick={() => act("requeue_expired")}
                disabled={busy !== null}
                className={btn.ghost}
              >
                {busy === "requeue_expired" ? "Toparlanıyor" : "Süresi dolanları topla"}
              </button>
            </div>
          }
        />

        <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
                filter === f ? "bg-raised text-text" : "text-muted hover:text-text"
              }`}
            >
              {f === "Tümü" ? f : LABEL[f]}
              {f !== "Tümü" && counts[f] ? (
                <span className="tnum ml-1.5 text-xs text-muted">{counts[f]}</span>
              ) : null}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title={filter === "Tümü" ? "Kuyruk boş." : `${LABEL[filter]} durumunda iş yok.`}
              detail={filter === "Tümü" ? "Bir çalışma başlattığında işler burada görünür." : undefined}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((j) => (
              <li key={j.job_id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Dot tone={TONE[j.status] ?? "idle"} />
                  <span className="text-sm font-medium">{j.job_type}</span>
                  <span className="text-sm text-muted">{LABEL[j.status] ?? j.status}</span>
                  {j.attempt > 0 && (
                    <Chip tone={j.attempt >= j.max_attempts ? "bad" : "attention"}>
                      {j.attempt}/{j.max_attempts} deneme
                    </Chip>
                  )}
                  <Link
                    href={`/runs/${j.run_id}`}
                    className="tnum text-sm text-muted hover:text-text"
                  >
                    {j.run_id.slice(0, 8)}
                  </Link>
                  <span className="tnum ml-auto text-sm text-muted">
                    {new Date(j.created_at).toLocaleString("tr-TR", {
                      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                </div>

                {j.last_error && (
                  <p className="mt-1.5 break-words text-sm text-bad">{j.last_error}</p>
                )}

                {(j.status === "FAILED" || j.status === "QUEUED") && (
                  <div className="mt-2 flex gap-2">
                    {j.status === "FAILED" && (
                      <button
                        onClick={() => act("retry", j.job_id)}
                        disabled={busy !== null}
                        className={btn.ghost}
                      >
                        {busy === j.job_id ? "…" : "Yeniden dene"}
                      </button>
                    )}
                    <button
                      onClick={() => act("cancel", j.job_id)}
                      disabled={busy !== null}
                      className={btn.danger}
                    >
                      İptal et
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, Chip, Dot, Notice, btn, field, type Tone } from "@/components/ui";
import type { Claim } from "@/lib/schemas";

const RISK_TONE: Record<string, Tone> = { high: "bad", medium: "attention", low: "idle" };
const RISK_LABEL: Record<string, string> = { high: "yüksek risk", medium: "orta risk", low: "düşük risk" };
const TYPE_LABEL: Record<string, string> = {
  fact: "olgu", statistic: "istatistik", quote: "alıntı",
  opinion: "görüş", instruction: "yönerge",
};

export function ApprovalForm({
  runId, claims, audience,
}: {
  runId: string;
  claims: Claim[];
  audience: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(true);

  const flaggedCount = claims.filter((c) => c.needs_review).length;
  const visible = useMemo(
    () => (onlyFlagged ? claims.filter((c) => c.needs_review) : claims),
    [claims, onlyFlagged]
  );
  const approvedCount = claims.length - rejected.size;

  function toggle(id: string) {
    setRejected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rejected_claim_ids: [...rejected],
          note: note.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Onaylanamadı");
      router.push(`/runs/${runId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Karar geri alınamaz; bunu düğmenin yanında değil, en başta söyle. */}
      <Notice tone="attention">
        Kaydettiğin an döküm donuyor ve değiştirilemiyor. Plan yalnız kabul
        ettiğin iddialarla üretilecek.
      </Notice>

      {audience && (
        <Card>
          <CardHeader
            title="Hedef kitle profili"
            hint="Model senaryodan bunu çıkardı; plan buna göre kurulacak."
          />
          <dl className="grid gap-x-6 gap-y-2 px-5 py-4 text-sm sm:grid-cols-2">
            {Object.entries(audience)
              .filter(([, v]) => typeof v === "string" || typeof v === "number")
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right">{String(v)}</dd>
                </div>
              ))}
          </dl>
        </Card>
      )}

      <Card>
        <CardHeader
          title={`${claims.length} iddia · ${flaggedCount} tanesi inceleme istiyor`}
          hint="Model kendi emin olmadığı iddiaları işaretledi. Kutuyu işaretlemek iddiayı REDDEDER."
          action={
            <button onClick={() => setOnlyFlagged((v) => !v)} className={btn.ghost}>
              {onlyFlagged ? "Hepsini göster" : "Yalnız işaretliler"}
            </button>
          }
        />

        <ul className="divide-y divide-line">
          {visible.map((c) => {
            const isRejected = rejected.has(c.claim_id);
            return (
              <li key={c.claim_id} className={`px-5 py-4 ${isRejected ? "opacity-50" : ""}`}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isRejected}
                    onChange={() => toggle(c.claim_id)}
                    className="mt-1"
                    aria-label={`${c.claim_id} iddiasını reddet`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="tnum text-xs text-muted">{c.claim_id}</span>
                      <Chip tone={RISK_TONE[c.risk] ?? "idle"}>{RISK_LABEL[c.risk] ?? c.risk}</Chip>
                      <span className="text-xs text-muted">{TYPE_LABEL[c.type] ?? c.type}</span>
                      {c.needs_review && (
                        <span className="flex items-center gap-1.5 text-xs text-attention">
                          <Dot tone="attention" /> inceleme istiyor
                        </span>
                      )}
                      <span className="tnum ml-auto text-xs text-muted">
                        güven {(c.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className={`text-sm leading-relaxed ${isRejected ? "line-through" : ""}`}>
                      {c.text}
                    </p>
                    {c.review_reason && (
                      <p className="mt-1 text-sm text-attention">{c.review_reason}</p>
                    )}
                    {c.source && <p className="mt-1 text-xs text-muted">kaynak: {c.source}</p>}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </Card>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Not</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Bu kararın gerekçesi — kayda geçer, sonradan okunur."
          className={`${field} resize-y`}
        />
      </label>

      {error && <Notice tone="bad">{error}</Notice>}

      <div className="flex flex-wrap items-center gap-4">
        <button onClick={submit} disabled={busy || approvedCount === 0} className={btn.primary}>
          {busy ? "Donduruluyor" : `${approvedCount} iddiayı onayla ve planla`}
        </button>
        <span className="text-sm text-muted">
          {rejected.size > 0 ? `${rejected.size} iddia reddedilecek` : "Hiçbir iddia reddedilmedi"}
        </span>
      </div>
    </div>
  );
}

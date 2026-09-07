"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, Chip, Notice, btn, field, type Tone } from "@/components/ui";
import type { Claim } from "@/lib/schemas";

const RISK_TONE: Record<string, Tone> = { high: "bad", medium: "attention", low: "idle" };
const RISK_LABEL: Record<string, string> = { high: "yüksek risk", medium: "orta risk", low: "düşük risk" };
const TYPE_LABEL: Record<string, string> = {
  fact: "olgu", statistic: "istatistik", quote: "alıntı",
  opinion: "görüş", instruction: "yönerge",
};

type Filter = "review" | "all" | "rejected";

/**
 * Onay ekranı.
 *
 * Eski hâlinde tek etkileşim "kutuyu işaretle = reddet" idi. İşaretlemek
 * evrensel olarak olumlu anlaşılır; insan riskli iddiaları işaretleyip
 * hepsini onayladığını sanabilirdi. Artık her iddianın iki açık düğmesi
 * var ve seçilmemiş bir iddia kalırsa gönderim durur — sessiz varsayılan
 * yok. Karar geri alınamadığı için son adımda ne olacağı tek tek yazılıyor.
 */
export function ApprovalForm({
  runId, claims, audience, script,
}: {
  runId: string;
  claims: Claim[];
  audience: Record<string, unknown> | null;
  script: string | null;
}) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<Record<string, "keep" | "drop">>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("review");
  const [confirming, setConfirming] = useState(false);
  const [query, setQuery] = useState("");

  const flagged = useMemo(() => claims.filter((c) => c.needs_review), [claims]);
  const dropped = claims.filter((c) => decisions[c.claim_id] === "drop");
  const kept = claims.filter((c) => decisions[c.claim_id] !== "drop");

  // Karar verilmemiş işaretli iddia = gönderimi durduran tek şey.
  // İşaretlenmemiş iddialar zaten "kabul" varsayılıyor; model onlardan
  // emin. İşaretlediğini insana sormadan geçirmek bu ekranın varlık
  // sebebini ortadan kaldırırdı.
  const undecided = flagged.filter((c) => !decisions[c.claim_id]);

  const visible = useMemo(() => {
    const base =
      filter === "review" ? flagged :
      filter === "rejected" ? dropped :
      claims;
    const q = query.trim().toLocaleLowerCase("tr");
    return q ? base.filter((c) => c.text.toLocaleLowerCase("tr").includes(q)) : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, query, claims, flagged, decisions]);

  function decide(id: string, d: "keep" | "drop") {
    setDecisions((prev) => {
      const next = { ...prev };
      // Aynı düğmeye ikinci kez basmak kararı geri alıyor: yanlış tıklamayı
      // düzeltmenin yolu, sayfayı yenilemek olmamalı.
      if (next[id] === d) delete next[id];
      else next[id] = d;
      return next;
    });
    setConfirming(false);
  }

  function decideAll(ids: string[], d: "keep" | "drop") {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = d;
      return next;
    });
    setConfirming(false);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rejected_claim_ids: dropped.map((c) => c.claim_id),
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
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* İlerleme, düğmenin yanında değil en başta: kaç karar kaldığını
          listeye inmeden görmek gerekiyor. */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
          <Meter done={flagged.length - undecided.length} total={flagged.length} />
          <div className="min-w-0 flex-1 text-sm">
            {undecided.length === 0 ? (
              <>Tüm işaretli iddialar karara bağlandı.</>
            ) : (
              <>
                <b className="tnum">{undecided.length}</b> işaretli iddia karar bekliyor.
                Model bunlardan emin değil.
              </>
            )}
            <div className="mt-0.5 text-muted">
              {kept.length} kabul · {dropped.length} ret · {claims.length} toplam
            </div>
          </div>
          {undecided.length > 0 && (
            <button
              onClick={() => decideAll(undecided.map((c) => c.claim_id), "keep")}
              className={btn.ghost}
            >
              Kalanları kabul et
            </button>
          )}
        </div>
      </Card>

      {audience && (
        <Card>
          <CardHeader title="Hedef kitle profili" hint="Plan buna göre kurulacak." />
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

      {script && (
        <details className="rounded-lg border border-line bg-panel">
          <summary className="cursor-pointer select-none px-5 py-3.5 text-sm">
            Kaynak senaryo
            <span className="ml-2 text-muted">iddiaları metinle karşılaştırmak için</span>
          </summary>
          <p className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-line px-5 py-4 text-sm leading-relaxed text-muted">
            {script}
          </p>
        </details>
      )}

      <Card>
        <CardHeader
          title="İddia dökümü"
          hint="Reddettiğin iddialar motion planına hiç gösterilmez; model göremediğini kullanamaz."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ara"
                className={`${field} h-8 w-36 py-1`}
              />
              <Tab on={filter === "review"} onClick={() => setFilter("review")}>
                İşaretli {flagged.length}
              </Tab>
              <Tab on={filter === "all"} onClick={() => setFilter("all")}>
                Tümü {claims.length}
              </Tab>
              <Tab on={filter === "rejected"} onClick={() => setFilter("rejected")}>
                Ret {dropped.length}
              </Tab>
            </div>
          }
        />

        {visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            {filter === "rejected" ? "Henüz reddedilen iddia yok." : "Bu filtreye uyan iddia yok."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((c) => {
              const d = decisions[c.claim_id];
              return (
                <li
                  key={c.claim_id}
                  className={`px-5 py-4 transition-opacity ${d === "drop" ? "opacity-45" : ""}`}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="tnum text-xs text-muted">{c.claim_id}</span>
                    <Chip tone={RISK_TONE[c.risk] ?? "idle"}>{RISK_LABEL[c.risk] ?? c.risk}</Chip>
                    <span className="text-xs text-muted">{TYPE_LABEL[c.type] ?? c.type}</span>
                    <span className="tnum ml-auto text-xs text-muted">
                      güven {(c.confidence * 100).toFixed(0)}%
                    </span>
                  </div>

                  <p className={`text-sm leading-relaxed ${d === "drop" ? "line-through" : ""}`}>
                    {c.text}
                  </p>

                  {c.review_reason && (
                    <p className="mt-1.5 text-sm text-attention">{c.review_reason}</p>
                  )}
                  {c.source && <p className="mt-1 text-xs text-muted">kaynak: {c.source}</p>}

                  <div className="mt-3 flex items-center gap-2">
                    <Choice on={d === "keep"} tone="good" onClick={() => decide(c.claim_id, "keep")}>
                      Kabul
                    </Choice>
                    <Choice on={d === "drop"} tone="bad" onClick={() => decide(c.claim_id, "drop")}>
                      Reddet
                    </Choice>
                    {!d && c.needs_review && (
                      <span className="text-xs text-attention">karar bekliyor</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
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

      {/* Onay iki adım: ilk tıklama ne olacağını yazıyor, ikincisi
          uyguluyor. Geri alınamayan bir işlem tek tıklamayla olmamalı. */}
      {confirming ? (
        <Card>
          <div className="space-y-3 px-5 py-4">
            <p className="text-sm">
              <b className="tnum">{kept.length}</b> iddia planlamaya girecek,{" "}
              <b className="tnum">{dropped.length}</b> iddia kalıcı olarak dışarıda kalacak.
              Döküm bu kararla donacak ve değiştirilemeyecek.
            </p>
            {dropped.length > 0 && (
              <ul className="max-h-32 space-y-1 overflow-auto text-xs text-muted">
                {dropped.map((c) => (
                  <li key={c.claim_id} className="truncate">— {c.claim_id}: {c.text}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={submit} disabled={busy} className={btn.primary}>
                {busy ? "Donduruluyor" : "Evet, dondur ve planla"}
              </button>
              <button onClick={() => setConfirming(false)} disabled={busy} className={btn.quiet}>
                Vazgeç
              </button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={() => setConfirming(true)}
            disabled={kept.length === 0 || undecided.length > 0}
            className={btn.primary}
          >
            Dökümü dondur ve planla
          </button>
          <span className="text-sm text-muted">
            {kept.length === 0
              ? "En az bir iddia kabul edilmeli."
              : undecided.length > 0
              ? `Önce ${undecided.length} işaretli iddiayı karara bağla.`
              : "Karar geri alınamaz."}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ parçalar */

function Meter({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-raised">
        <div
          className={`h-full rounded-full ${pct === 100 ? "bg-good" : "bg-attention"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tnum text-sm text-muted">{done}/{total}</span>
    </div>
  );
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
        on ? "bg-raised text-text" : "text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function Choice({
  on, tone, onClick, children,
}: {
  on: boolean; tone: "good" | "bad"; onClick: () => void; children: React.ReactNode;
}) {
  const active = tone === "good"
    ? "border-good/60 bg-good/10 text-good"
    : "border-bad/60 bg-bad/10 text-bad";
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-md border px-3 py-1 text-xs transition-colors ${
        on ? active : "border-line text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

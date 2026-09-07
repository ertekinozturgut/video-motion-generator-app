"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

/**
 * Takılan sahnenin insan tarafındaki iki çıkışı.
 *
 * Ekranda "insan bekliyor" yazıp insana bir düğme vermemek, durumu
 * çıkmaz sokağa çevirir. Atlamak yıkıcı olduğu için tek tıklamada
 * olmuyor: ikinci tıklama onaylıyor.
 */
export function Recover({
  runId, motionId, compact = false,
}: {
  runId: string;
  motionId?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"retry" | "skip" | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "retry" | "skip") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motion_id: motionId ?? null, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "İşlem yapılamadı");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setConfirmSkip(false);
    }
  }

  return (
    <div className={compact ? "flex items-center gap-2" : "flex flex-wrap items-center gap-3"}>
      <button onClick={() => send("retry")} disabled={busy !== null} className={compact ? btn.ghost : btn.primary}>
        {busy === "retry" ? "Kuyruğa alınıyor" : motionId ? "Yeniden üret" : "Takılanları yeniden üret"}
      </button>

      {motionId && (
        confirmSkip ? (
          <button onClick={() => send("skip")} disabled={busy !== null} className={btn.danger}>
            {busy === "skip" ? "Atlanıyor" : "Emin misin? Atla"}
          </button>
        ) : (
          <button onClick={() => setConfirmSkip(true)} disabled={busy !== null} className={btn.quiet}>
            Atla
          </button>
        )
      )}

      {error && <span className="text-sm text-bad">{error}</span>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewRunPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [script, setScript] = useState("");

  async function submit(formData: FormData) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: formData.get("title"),
          script,
          audience_hint: formData.get("audience_hint"),
          format: formData.get("format"),
          budget_limit: formData.get("budget_limit"),
          stub_motion_count: formData.get("stub_motion_count"),
          dry_run: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Çalışma başlatılamadı");
      router.push(`/runs/${body.run_id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Yeni çalışma</h1>
      <p className="mb-8 text-sm text-muted">
        Senaryoyu yapıştır. Sistem bilgileri kontrol eder, senden onay ister,
        sonra motion&apos;ları üretir.
      </p>

      <form action={submit} className="space-y-6">
        <Field label="Başlık" hint="Boş bırakırsan senaryodan üretilir">
          <input name="title" type="text" className={inputClass} placeholder="n8n ile ilk otomasyonun" />
        </Field>

        <Field label="Senaryo" hint={`${script.length} karakter`}>
          <textarea
            name="script"
            required
            rows={12}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            className={`${inputClass} resize-y leading-relaxed`}
            placeholder="Videonun tam konuşma metnini buraya yapıştır…"
          />
        </Field>

        <Field label="Hedef kitle" hint="Kime anlatıyorsun">
          <input
            name="audience_hint"
            type="text"
            className={inputClass}
            placeholder="n8n'e yeni başlayan, yazılımcı olmayan izleyici"
          />
        </Field>

        <div className="grid gap-6 sm:grid-cols-3">
          <Field label="Format">
            <select name="format" className={inputClass} defaultValue="youtube_16_9">
              <option value="youtube_16_9">YouTube 16:9</option>
              <option value="shorts_9_16">Shorts 9:16</option>
            </select>
          </Field>
          <Field label="Bütçe" hint="USD">
            <input name="budget_limit" type="number" min="0" max="500" step="0.5"
                   defaultValue="5" className={`${inputClass} tnum`} />
          </Field>
          <Field label="Motion sayısı" hint="Sprint 1 provası">
            <input name="stub_motion_count" type="number" min="1" max="24"
                   defaultValue="8" className={`${inputClass} tnum`} />
          </Field>
        </div>

        <div className="rounded border border-line bg-panel p-3 text-sm text-muted">
          Bu sürümde adımlar taklit ediliyor: model çağrısı yapılmıyor, render
          alınmıyor, ücret oluşmuyor.
        </div>

        {error && (
          <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy || script.trim().length < 40}
          className="rounded bg-text px-5 py-2.5 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Başlatılıyor" : "Çalışmayı başlat"}
        </button>
      </form>
    </div>
  );
}

const inputClass =
  "w-full rounded border border-line bg-panel px-3 py-2 text-sm text-text placeholder:text-muted/60";

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="tnum text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

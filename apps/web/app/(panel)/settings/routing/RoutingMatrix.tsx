"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  STEPS, STEP_ORDER, checkEligibility, validateRoutes,
  type Issue, type PipelineStep, type ResolvedModel,
} from "@/lib/providers/routing";

export interface ModelOption extends ResolvedModel {
  model_key: string;
}

export interface SavedRoute {
  step: PipelineStep;
  primary_model_id: string;
  fallback_model_ids: string[];
  disable_compression: boolean;
}

export function RoutingMatrix({
  presetId, models, initial,
}: {
  presetId: string;
  models: ModelOption[];
  initial: SavedRoute[];
}) {
  const router = useRouter();
  const [routes, setRoutes] = useState<Record<string, SavedRoute>>(
    Object.fromEntries(initial.map((r) => [r.step, r]))
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const byId = useMemo(() => new Map(models.map((m) => [m.model_id, m])), [models]);

  const issues: Issue[] = useMemo(() => {
    const list = Object.values(routes)
      .filter((r) => byId.has(r.primary_model_id))
      .map((r) => ({
        step: r.step,
        primary: byId.get(r.primary_model_id)!,
        fallbacks: r.fallback_model_ids.map((id) => byId.get(id)).filter(Boolean) as ResolvedModel[],
        disable_compression: r.disable_compression,
      }));
    return validateRoutes(list);
  }, [routes, byId]);

  const errors = issues.filter((i) => i.severity === "error");
  const assigned = Object.keys(routes).length;

  function setStep(step: PipelineStep, patch: Partial<SavedRoute>) {
    setRoutes((prev) => ({
      ...prev,
      [step]: {
        step,
        primary_model_id: "",
        fallback_model_ids: [],
        disable_compression: STEPS[step].require_no_compression,
        ...prev[step],
        ...patch,
      },
    }));
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/routing", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preset_id: presetId,
          routes: Object.values(routes).filter((r) => r.primary_model_id),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Kaydedilemedi");
      setMessage(`${json.saved} adım kaydedildi`);
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (models.length === 0) {
    return (
      <div className="rounded border border-line bg-panel p-8 text-sm">
        <p className="mb-1">Seçilebilecek model yok.</p>
        <p className="text-muted">
          Önce sağlayıcı ekleyip modelleri getir. Kontrol adımlarının
          çalışması için en az iki farklı model ailesi gerekiyor.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className={errors.length ? "text-bad" : "text-good"}>
          {errors.length ? `${errors.length} engel var` : "Doğrulama temiz"}
        </span>
        <span className="tnum text-muted">{assigned} / {STEP_ORDER.length} adım atandı</span>
        <button onClick={save} disabled={busy || errors.length > 0 || assigned === 0}
                className="ml-auto rounded bg-text px-4 py-2 text-sm font-medium text-ink disabled:opacity-40">
          {busy ? "Kaydediliyor" : "Kaydet"}
        </button>
      </div>

      {message && (
        <p className="rounded border border-active/40 bg-active/10 px-3 py-2 text-sm">{message}</p>
      )}

      <ul className="space-y-3">
        {STEP_ORDER.map((step) => {
          const req = STEPS[step];
          const route = routes[step];
          const stepIssues = issues.filter((i) => i.step === step);
          const eligible = models.filter((m) => checkEligibility(step, m.capabilities).eligible);

          return (
            <li key={step} className="rounded border border-line bg-panel p-4">
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{req.label}</span>
                {req.must_differ_from && (
                  <span className="text-sm text-attention">farklı model ailesi zorunlu</span>
                )}
                {req.sees_source_script && (
                  <span className="text-sm text-muted">senaryoyu görür</span>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-muted">Birincil</span>
                  <select
                    value={route?.primary_model_id ?? ""}
                    onChange={(e) => setStep(step, { primary_model_id: e.target.value })}
                    className={select}
                  >
                    <option value="">Seçilmedi</option>
                    {models.map((m) => {
                      const ok = eligible.some((x) => x.model_id === m.model_id);
                      return (
                        <option key={m.model_id} value={m.model_id} disabled={!ok}>
                          {m.display_name} · {m.family}
                          {ok ? "" : ` — ${checkEligibility(step, m.capabilities).reason}`}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs text-muted">Yedek</span>
                  <select
                    value={route?.fallback_model_ids[0] ?? ""}
                    onChange={(e) => setStep(step, {
                      fallback_model_ids: e.target.value ? [e.target.value] : [],
                    })}
                    className={select}
                  >
                    <option value="">Yok</option>
                    {eligible
                      .filter((m) => m.model_id !== route?.primary_model_id)
                      .map((m) => (
                        <option key={m.model_id} value={m.model_id}>
                          {m.display_name} · {m.family}
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              {!req.require_no_compression && (
                <label className="mt-3 flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox"
                         checked={route?.disable_compression ?? false}
                         onChange={(e) => setStep(step, { disable_compression: e.target.checked })} />
                  Gateway sıkıştırmasını kapat
                </label>
              )}

              {stepIssues.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {stepIssues.map((i, n) => (
                    <li key={n} className={`text-sm ${i.severity === "error" ? "text-bad" : "text-attention"}`}>
                      {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const select = "w-full rounded border border-line bg-ink px-3 py-2 text-sm text-text";

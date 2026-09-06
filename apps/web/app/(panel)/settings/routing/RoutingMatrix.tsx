"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  STEPS, STEP_ORDER, checkEligibility, validateRoutes,
  type Issue, type PipelineStep, type ResolvedModel,
} from "@/lib/providers/routing";
import type { ResolvedModelOption, SavedRouteRow } from "@/lib/admin/snapshot";
import { Card, Chip, Dot, Notice, btn, field, type Tone } from "@/components/ui";

export function RoutingMatrix({
  presetId, models, initial, familyCount,
}: {
  presetId: string;
  models: ResolvedModelOption[];
  initial: SavedRouteRow[];
  familyCount: number;
}) {
  const router = useRouter();
  const [routes, setRoutes] = useState<Record<string, SavedRouteRow>>(
    Object.fromEntries(initial.map((r) => [r.step, r]))
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);

  const byId = useMemo(() => new Map(models.map((m) => [m.model_id, m])), [models]);

  const issues: Issue[] = useMemo(() => {
    const list = Object.values(routes)
      .filter((r) => byId.has(r.primary_model_id))
      .map((r) => ({
        step: r.step,
        primary: byId.get(r.primary_model_id)!,
        fallbacks: r.fallback_model_ids
          .map((id) => byId.get(id))
          .filter((m): m is ResolvedModelOption => Boolean(m)) as ResolvedModel[],
        disable_compression: r.disable_compression,
      }));
    return validateRoutes(list);
  }, [routes, byId]);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const assigned = Object.values(routes).filter((r) => r.primary_model_id).length;

  function setStep(step: PipelineStep, patch: Partial<SavedRouteRow>) {
    setRoutes((prev) => {
      const base: SavedRouteRow = prev[step] ?? {
        step,
        primary_model_id: "",
        fallback_model_ids: [],
        disable_compression: STEPS[step].require_no_compression,
      };
      return { ...prev, [step]: { ...base, ...patch, step } };
    });
  }

  async function save() {
    setBusy(true);
    setNotice(null);
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
      setNotice({ tone: "good", text: `${json.saved} adım kaydedildi` });
      router.refresh();
    } catch (e) {
      setNotice({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Kaydet düğmesi listenin üstünde ve yapışkan: yedi adımı gezerken
          durumu görmek için başa dönmek gerekmesin. */}
      <div className="sticky top-16 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-panel/95 px-4 py-3 shadow-lg shadow-ink/40 backdrop-blur">
        <Dot tone={errors.length ? "bad" : assigned === STEP_ORDER.length ? "good" : "attention"} />
        <span className={`text-sm ${errors.length ? "text-bad" : "text-good"}`}>
          {errors.length ? `${errors.length} engel var` : "Doğrulama temiz"}
        </span>
        <span className="tnum text-sm text-muted">
          {assigned} / {STEP_ORDER.length} adım atandı
        </span>
        {warnings.length > 0 && !errors.length && (
          <span className="text-sm text-attention">{warnings.length} uyarı</span>
        )}
        <button
          onClick={save}
          disabled={busy || errors.length > 0 || assigned === 0}
          className={`${btn.primary} ml-auto`}
        >
          {busy ? "Kaydediliyor" : "Kaydet"}
        </button>
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {familyCount < 2 && (
        <Notice tone="attention">
          Tek model ailesi var. Kontrol adımları (plan kontrolü, video kontrolü)
          üreten adımdan farklı aileye bakmak zorunda; ikinci bir aile eklenene
          kadar bu adımlar engelli kalır.
        </Notice>
      )}

      <ul className="space-y-3">
        {STEP_ORDER.map((step) => {
          const req = STEPS[step];
          const route = routes[step];
          const stepIssues = issues.filter((i) => i.step === step);
          const stepErrors = stepIssues.filter((i) => i.severity === "error");
          const eligible = models.filter((m) => checkEligibility(step, m.capabilities).eligible);
          const primary = route?.primary_model_id ? byId.get(route.primary_model_id) : undefined;

          return (
            <Card key={step}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-5 py-3.5">
                <Dot tone={stepErrors.length ? "bad" : primary ? "good" : "idle"} />
                <span className="font-medium">{req.label}</span>
                <span className="tnum text-xs text-muted">{step}</span>
                <span className="ml-auto flex flex-wrap gap-2">
                  {req.must_differ_from && (
                    <Chip tone="attention">
                      {STEPS[req.must_differ_from].label} ile aynı aile olamaz
                    </Chip>
                  )}
                  {req.sees_source_script && <Chip>senaryoyu görür</Chip>}
                  {req.vision && <Chip>görsel girdi</Chip>}
                  {req.tools && <Chip>tool use</Chip>}
                </span>
              </div>

              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted">
                    Birincil
                  </span>
                  <select
                    value={route?.primary_model_id ?? ""}
                    onChange={(e) => setStep(step, { primary_model_id: e.target.value })}
                    className={field}
                  >
                    <option value="">Seçilmedi</option>
                    {models.map((m) => {
                      const check = checkEligibility(step, m.capabilities);
                      return (
                        <option key={m.model_id} value={m.model_id} disabled={!check.eligible}>
                          {m.display_name} · {m.family}
                          {check.eligible ? "" : ` — ${check.reason}`}
                        </option>
                      );
                    })}
                  </select>
                  {primary && (
                    <span className="mt-1.5 block text-xs text-muted">
                      {primary.provider_label} ·{" "}
                      {primary.capabilities.context_window.toLocaleString("tr-TR")} token
                    </span>
                  )}
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-wide text-muted">
                    Yedek
                  </span>
                  <select
                    value={route?.fallback_model_ids[0] ?? ""}
                    onChange={(e) =>
                      setStep(step, { fallback_model_ids: e.target.value ? [e.target.value] : [] })
                    }
                    className={field}
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
                  <span className="mt-1.5 block text-xs text-muted">
                    Yedek de aynı aile kuralına tabi.
                  </span>
                </label>
              </div>

              {!req.require_no_compression && (
                <label className="flex items-center gap-2 px-5 pb-4 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={route?.disable_compression ?? false}
                    onChange={(e) => setStep(step, { disable_compression: e.target.checked })}
                  />
                  Gateway sıkıştırmasını kapat
                </label>
              )}

              {stepIssues.length > 0 && (
                <ul className="divide-y divide-line border-t border-line">
                  {stepIssues.map((i, n) => (
                    <li
                      key={n}
                      className={`px-5 py-2.5 text-sm ${
                        i.severity === "error" ? "text-bad" : "text-attention"
                      }`}
                    >
                      {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </ul>
    </div>
  );
}

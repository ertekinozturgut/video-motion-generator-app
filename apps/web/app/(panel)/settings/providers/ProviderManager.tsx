"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PROVIDER_LABEL, type ProviderKind } from "@/lib/providers/types";

export interface ProviderRow {
  provider_id: string;
  kind: ProviderKind;
  label: string;
  base_url: string | null;
  status: string;
  data_policy: string;
  network_scope: string;
  last_latency_ms: number | null;
  last_error: string | null;
  model_count: number;
  last4: string | null;
}

const KINDS: ProviderKind[] = ["openai", "azure_foundry", "anthropic", "openrouter", "omniroute"];

const HINT: Record<ProviderKind, string> = {
  openai: "Katalog otomatik gelir.",
  azure_foundry: "Model adı değil deployment adı kullanılır; modelleri elle eklersin.",
  anthropic: "Şema tool call ile dayatılır; prompt cache kazancı burada.",
  openrouter: "Fiyat ve yetenekleri döndüren tek katalog. Veri toplama kapalı gönderilir.",
  omniroute: "Kendi barındırdığın gateway. Yerel adres girersen yalnız local worker kullanır.",
};

export function ProviderManager({ providers }: { providers: ProviderRow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ProviderKind>("openai");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function call(url: string, body: unknown, method = "POST") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "İşlem başarısız");
      return json;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addProvider(form: FormData) {
    const config: Record<string, unknown> = {};
    if (kind === "azure_foundry") {
      config.api_version = form.get("api_version") || "2024-10-21";
      config.flavor = form.get("flavor") || "openai";
      config.auth_mode = form.get("auth_mode") || "api_key";
    }
    if (kind === "openrouter") {
      config.data_collection = "deny";
      config.app_title = "Video Panel";
    }
    if (kind === "anthropic") config.anthropic_version = "2023-06-01";

    const result = await call("/api/providers", {
      kind,
      label: form.get("label"),
      base_url: form.get("base_url") || null,
      api_key: form.get("api_key"),
      data_policy: form.get("data_policy"),
      config,
    });
    if (result) {
      if (result.note) setNotice(result.note);
      setAdding(false);
      router.refresh();
    }
  }

  async function testProvider(id: string, modelKey: string) {
    const r = await call(`/api/providers/${id}/test`, { model_key: modelKey });
    if (r) {
      setNotice(
        r.ok
          ? `Bağlantı çalışıyor (${r.latency_ms} ms)${r.json_mode_verified ? ", JSON modu doğrulandı" : ", JSON modu doğrulanamadı"}`
          : `Bağlanılamadı: ${r.detail}`
      );
      router.refresh();
    }
  }

  async function syncModels(id: string) {
    const r = await call(`/api/providers/${id}/models`, { mode: "sync" });
    if (r) {
      setNotice(r.note ?? `${r.synced} model senkronlandı`);
      router.refresh();
    }
  }

  return (
    <div className="space-y-8">
      {notice && (
        <p className="rounded border border-active/40 bg-active/10 px-3 py-2 text-sm">{notice}</p>
      )}
      {error && (
        <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm">{error}</p>
      )}

      {providers.length === 0 && !adding && (
        <div className="rounded border border-line bg-panel p-8">
          <p className="mb-1">Henüz bir sağlayıcı yok.</p>
          <p className="mb-5 text-sm text-muted">
            Planlama ve kontrol adımlarının çalışması için en az iki farklı
            model ailesi gerekiyor.
          </p>
          <button onClick={() => setAdding(true)}
                  className="rounded bg-text px-4 py-2 text-sm font-medium text-ink">
            Sağlayıcı ekle
          </button>
        </div>
      )}

      {providers.length > 0 && (
        <ul className="divide-y divide-line rounded border border-line bg-panel">
          {providers.map((p) => (
            <ProviderItem key={p.provider_id} provider={p} busy={busy}
                          onTest={testProvider} onSync={syncModels}
                          onDelete={async (id) => {
                            if (!confirm(`${p.label} silinsin mi? Anahtarı da kaldırılır.`)) return;
                            const r = await call(`/api/providers/${id}`, null, "DELETE");
                            if (r) router.refresh();
                          }} />
          ))}
        </ul>
      )}

      {providers.length > 0 && !adding && (
        <button onClick={() => setAdding(true)}
                className="rounded border border-line px-4 py-2 text-sm hover:bg-raised">
          Sağlayıcı ekle
        </button>
      )}

      {adding && (
        <form action={addProvider} className="space-y-5 rounded border border-line bg-panel p-5">
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                      className={`rounded border px-3 py-1.5 text-sm ${
                        kind === k ? "border-text bg-raised" : "border-line text-muted hover:text-text"
                      }`}>
                {PROVIDER_LABEL[k]}
              </button>
            ))}
          </div>

          <p className="text-sm text-muted">{HINT[kind]}</p>

          <Row label="Ad">
            <input name="label" required placeholder={`${PROVIDER_LABEL[kind]} — üretim`}
                   className={input} />
          </Row>

          {(kind === "azure_foundry" || kind === "omniroute") && (
            <Row label="Adres" hint="https zorunlu">
              <input name="base_url" required
                     placeholder={kind === "azure_foundry"
                       ? "https://<kaynak>.services.ai.azure.com"
                       : "https://gateway.example.com/v1"}
                     className={input} />
            </Row>
          )}

          <Row label="API anahtarı" hint="Kaydedildikten sonra okunamaz">
            <input name="api_key" type="password" required autoComplete="off" className={input} />
          </Row>

          {kind === "azure_foundry" && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Row label="api-version">
                <input name="api_version" defaultValue="2024-10-21" className={input} />
              </Row>
              <Row label="Model ailesi">
                <select name="flavor" defaultValue="openai" className={input}>
                  <option value="openai">OpenAI deployment</option>
                  <option value="inference">Diğer (Llama, Mistral…)</option>
                </select>
              </Row>
              <Row label="Kimlik doğrulama">
                <select name="auth_mode" defaultValue="api_key" className={input}>
                  <option value="api_key">API anahtarı</option>
                  <option value="entra">Entra ID</option>
                </select>
              </Row>
            </div>
          )}

          <Row label="Veri politikası"
               hint="Senaryo metnini gören adımlar yalnız &quot;eğitimde kullanılmaz&quot; kabul eder">
            <select name="data_policy" defaultValue="unknown" className={input}>
              <option value="no_training">Eğitimde kullanılmaz</option>
              <option value="unknown">Bilinmiyor</option>
              <option value="may_train">Eğitimde kullanılabilir</option>
            </select>
          </Row>

          <div className="flex gap-3">
            <button type="submit" disabled={busy}
                    className="rounded bg-text px-4 py-2 text-sm font-medium text-ink disabled:opacity-40">
              {busy ? "Kaydediliyor" : "Kaydet"}
            </button>
            <button type="button" onClick={() => setAdding(false)}
                    className="rounded border border-line px-4 py-2 text-sm text-muted hover:text-text">
              Vazgeç
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ProviderItem({
  provider: p, busy, onTest, onSync, onDelete,
}: {
  provider: ProviderRow;
  busy: boolean;
  onTest: (id: string, modelKey: string) => void;
  onSync: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [modelKey, setModelKey] = useState("");
  const tone = p.status === "active" ? "bg-good" : p.status === "degraded" ? "bg-bad" : "bg-idle";

  return (
    <li className="px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden />
        <span className="font-medium">{p.label}</span>
        <span className="text-sm text-muted">{PROVIDER_LABEL[p.kind]}</span>
        {p.last4 && <span className="tnum text-sm text-muted">••••{p.last4}</span>}
        <span className="tnum ml-auto text-sm text-muted">{p.model_count} model</span>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-muted">
        {p.last_latency_ms != null && <span className="tnum">{p.last_latency_ms} ms</span>}
        {p.data_policy !== "no_training" && (
          <span className="text-attention">
            {p.data_policy === "may_train" ? "eğitimde kullanılabilir" : "veri politikası bilinmiyor"}
          </span>
        )}
        {p.network_scope === "local_worker_only" && (
          <span className="text-attention">yalnız local worker</span>
        )}
      </div>

      {p.last_error && (
        <p className="mt-2 text-sm text-bad">{p.last_error}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={modelKey} onChange={(e) => setModelKey(e.target.value)}
               placeholder={p.kind === "azure_foundry" ? "deployment adı" : "model adı"}
               className={`${input} max-w-56`} />
        <button disabled={busy || !modelKey.trim()}
                onClick={() => onTest(p.provider_id, modelKey.trim())}
                className="rounded border border-line px-3 py-1.5 text-sm hover:bg-raised disabled:opacity-40">
          Bağlantıyı sına
        </button>
        <button disabled={busy} onClick={() => onSync(p.provider_id)}
                className="rounded border border-line px-3 py-1.5 text-sm hover:bg-raised disabled:opacity-40">
          Modelleri getir
        </button>
        <button disabled={busy} onClick={() => onDelete(p.provider_id)}
                className="ml-auto rounded px-3 py-1.5 text-sm text-muted hover:text-bad">
          Sil
        </button>
      </div>
    </li>
  );
}

const input =
  "w-full rounded border border-line bg-ink px-3 py-2 text-sm text-text placeholder:text-muted/60";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

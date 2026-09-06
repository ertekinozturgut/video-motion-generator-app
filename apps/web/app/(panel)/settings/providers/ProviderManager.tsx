"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PROVIDER_LABEL, type ProviderKind } from "@/lib/providers/types";
import {
  Card, CardHeader, Chip, Dot, EmptyState, Field, Notice, btn, field, type Tone,
} from "@/components/ui";

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
  families: string[];
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

const STATUS_TONE: Record<string, Tone> = {
  active: "good", degraded: "bad", disabled: "idle", unverified: "idle",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Doğrulandı", degraded: "Sorunlu", disabled: "Kapalı", unverified: "Sınanmadı",
};

export function ProviderManager({
  providers, familyCount,
}: {
  providers: ProviderRow[];
  familyCount: number;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ProviderKind>("openai");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);

  async function call(url: string, body: unknown, method = "POST") {
    setBusy(true);
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
      setNotice({ tone: "bad", text: (e as Error).message });
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
      setNotice({ tone: result.note ? "attention" : "good", text: result.note ?? "Sağlayıcı kaydedildi. Sıradaki adım: bağlantıyı sına." });
      setAdding(false);
      router.refresh();
    }
  }

  async function testProvider(id: string, modelKey: string) {
    const r = await call(`/api/providers/${id}/test`, { model_key: modelKey });
    if (r) {
      setNotice(
        r.ok
          ? {
              tone: r.json_mode_verified ? "good" : "attention",
              text: `Bağlantı çalışıyor (${r.latency_ms} ms)${r.json_mode_verified ? ", JSON modu doğrulandı" : ", JSON modu doğrulanamadı"}`,
            }
          : { tone: "bad", text: `Bağlanılamadı: ${r.detail}` }
      );
      router.refresh();
    }
  }

  async function syncModels(id: string) {
    const r = await call(`/api/providers/${id}/models`, { mode: "sync" });
    if (r) {
      setNotice({ tone: "good", text: r.note ?? `${r.synced} model senkronlandı` });
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {providers.length > 0 && familyCount < 2 && (
        <Notice tone="attention">
          Şu an {familyCount === 0 ? "hiç" : "yalnız tek"} model ailesi var. Kontrol
          adımları üreten adımdan farklı bir aileye bakmak zorunda; ikinci bir aile
          eklenmeden plan kontrolü ve video kontrolü atanamaz.
        </Notice>
      )}

      {providers.length === 0 && !adding ? (
        <EmptyState
          title="Henüz bir sağlayıcı yok."
          detail="Planlama ve kontrol adımlarının çalışması için en az iki farklı model ailesi gerekiyor — örneğin bir GPT, bir Claude."
          action={
            <button onClick={() => setAdding(true)} className={btn.primary}>
              Sağlayıcı ekle
            </button>
          }
        />
      ) : (
        providers.length > 0 && (
          <Card>
            <CardHeader
              title={`${providers.length} sağlayıcı`}
              hint={`${familyCount} kullanılabilir model ailesi.`}
              action={
                !adding && (
                  <button onClick={() => setAdding(true)} className={btn.ghost}>
                    Sağlayıcı ekle
                  </button>
                )
              }
            />
            <ul className="divide-y divide-line">
              {providers.map((p) => (
                <ProviderItem
                  key={p.provider_id}
                  provider={p}
                  busy={busy}
                  onTest={testProvider}
                  onSync={syncModels}
                  onDelete={async (id) => {
                    if (!confirm(`${p.label} silinsin mi? Anahtarı da kaldırılır.`)) return;
                    const r = await call(`/api/providers/${id}`, null, "DELETE");
                    if (r) {
                      setNotice({ tone: "good", text: `${p.label} silindi.` });
                      router.refresh();
                    }
                  }}
                />
              ))}
            </ul>
          </Card>
        )
      )}

      {adding && (
        <Card>
          <CardHeader
            title="Sağlayıcı ekle"
            hint="Anahtar sunucuda şifrelenir; bu formdan sonra hiçbir ekranda tekrar görünmez."
          />
          <form action={addProvider} className="space-y-5 p-5">
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    kind === k
                      ? "border-text bg-raised text-text"
                      : "border-line text-muted hover:text-text"
                  }`}
                >
                  {PROVIDER_LABEL[k]}
                </button>
              ))}
            </div>

            <p className="text-sm text-muted">{HINT[kind]}</p>

            <Field label="Ad">
              <input name="label" required placeholder={`${PROVIDER_LABEL[kind]} — üretim`} className={field} />
            </Field>

            {(kind === "azure_foundry" || kind === "omniroute") && (
              <Field label="Adres" hint="https zorunlu">
                <input
                  name="base_url"
                  required
                  placeholder={
                    kind === "azure_foundry"
                      ? "https://<kaynak>.services.ai.azure.com"
                      : "https://gateway.example.com/v1"
                  }
                  className={field}
                />
              </Field>
            )}

            <Field label="API anahtarı" hint="Kaydedildikten sonra okunamaz">
              <input name="api_key" type="password" required autoComplete="off" className={field} />
            </Field>

            {kind === "azure_foundry" && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="api-version">
                  <input name="api_version" defaultValue="2024-10-21" className={field} />
                </Field>
                <Field label="Model ailesi">
                  <select name="flavor" defaultValue="openai" className={field}>
                    <option value="openai">OpenAI deployment</option>
                    <option value="inference">Diğer (Llama, Mistral…)</option>
                  </select>
                </Field>
                <Field label="Kimlik doğrulama">
                  <select name="auth_mode" defaultValue="api_key" className={field}>
                    <option value="api_key">API anahtarı</option>
                    <option value="entra">Entra ID</option>
                  </select>
                </Field>
              </div>
            )}

            <Field
              label="Veri politikası"
              hint="Senaryoyu gören adımlar yalnız &quot;eğitimde kullanılmaz&quot; kabul eder"
            >
              <select name="data_policy" defaultValue="unknown" className={field}>
                <option value="no_training">Eğitimde kullanılmaz</option>
                <option value="unknown">Bilinmiyor</option>
                <option value="may_train">Eğitimde kullanılabilir</option>
              </select>
            </Field>

            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={busy} className={btn.primary}>
                {busy ? "Kaydediliyor" : "Kaydet"}
              </button>
              <button type="button" onClick={() => setAdding(false)} className={btn.quiet}>
                Vazgeç
              </button>
            </div>
          </form>
        </Card>
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
  const tone = STATUS_TONE[p.status] ?? "idle";

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Dot tone={tone} />
        <span className="font-medium">{p.label}</span>
        <span className="text-sm text-muted">{PROVIDER_LABEL[p.kind]}</span>
        {p.last4 && <span className="tnum text-sm text-muted">••••{p.last4}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Chip tone={tone}>{STATUS_LABEL[p.status] ?? p.status}</Chip>
          <span className="tnum text-sm text-muted">{p.model_count} model</span>
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {p.last_latency_ms != null && <span className="tnum">{p.last_latency_ms} ms</span>}
        {p.families.length > 0 && <span>{p.families.join(", ")}</span>}
        {p.data_policy !== "no_training" && (
          <span className="text-attention">
            {p.data_policy === "may_train" ? "eğitimde kullanılabilir" : "veri politikası bilinmiyor"}
          </span>
        )}
        {p.network_scope === "local_worker_only" && (
          <span className="text-attention">yalnız local worker</span>
        )}
      </div>

      {p.last_error && <p className="mt-2 break-words text-sm text-bad">{p.last_error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={modelKey}
          onChange={(e) => setModelKey(e.target.value)}
          placeholder={p.kind === "azure_foundry" ? "deployment adı" : "model adı"}
          aria-label="Sınanacak model"
          className={`${field} max-w-56`}
        />
        <button
          disabled={busy || !modelKey.trim()}
          onClick={() => onTest(p.provider_id, modelKey.trim())}
          className={btn.ghost}
        >
          Bağlantıyı sına
        </button>
        <button disabled={busy} onClick={() => onSync(p.provider_id)} className={btn.ghost}>
          Modelleri getir
        </button>
        <button disabled={busy} onClick={() => onDelete(p.provider_id)} className={`${btn.danger} ml-auto`}>
          Sil
        </button>
      </div>
    </li>
  );
}

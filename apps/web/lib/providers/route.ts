import type { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadProvider } from "./load";
import { chatComplete, type ChatMessage } from "./chat";
import { recordAttempt } from "@/lib/jobs/trace";
import type { PipelineStep } from "./routing";
import type { JsonModeTier, ModelFamily } from "./types";

/**
 * Adım → model. Routing tablosunda ne yazıyorsa o çağrılır.
 *
 * Model seçimi burada bitiyor; hiçbir handler kendi modelini seçmiyor.
 * Seçim handler'a bırakılsaydı aile çeşitliliği kuralı (kontrol adımı
 * ürettiği adımdan farklı aileden olmalı) kod içinde dağılırdı ve bir
 * gün biri onu atlardı.
 */

export interface ResolvedRoute {
  step: PipelineStep;
  chain: RouteCandidate[];
}

export interface RouteCandidate {
  modelId: string;
  modelKey: string;
  displayName: string;
  family: ModelFamily;
  jsonTier: JsonModeTier;
  maxOutput: number;
  providerId: string;
  providerLabel: string;
  networkScope: string;
  /** Girdi/çıktı 1M token fiyatı; maliyet hesabı için. */
  pricing: { input_per_mtok?: number; output_per_mtok?: number } | null;
}

export async function resolveRoute(
  step: PipelineStep,
  ownerId: string
): Promise<ResolvedRoute> {
  const db = createAdminClient();

  const { data: preset } = await db
    .from("model_presets").select("preset_id").eq("owner_id", ownerId)
    .order("is_default", { ascending: false }).limit(1).maybeSingle();
  if (!preset) throw new Error("Model profili yok; /settings/routing ekranından dağıtım yap.");

  const { data: route } = await db
    .from("model_routes")
    .select("primary_model_id,fallback_model_ids")
    .eq("preset_id", (preset as { preset_id: string }).preset_id)
    .eq("step", step)
    .maybeSingle();
  if (!route) throw new Error(`${step} adımına model atanmamış; /settings/routing ekranından ata.`);

  const r = route as { primary_model_id: string; fallback_model_ids: string[] | null };
  const ids = [r.primary_model_id, ...(r.fallback_model_ids ?? [])];

  const { data: models } = await db
    .from("provider_models")
    .select("model_id,model_key,display_name,family,capabilities,pricing,provider_id,providers(label,network_scope)")
    .in("model_id", ids);

  const byId = new Map(
    ((models ?? []) as Array<Record<string, unknown>>).map((m) => [String(m.model_id), m])
  );

  // Sıra korunuyor: birincil önce, yedekler yazıldığı sırada.
  const chain: RouteCandidate[] = [];
  for (const id of ids) {
    const m = byId.get(id);
    if (!m) continue;
    const rel = m.providers as { label?: string; network_scope?: string } | Array<{ label?: string; network_scope?: string }> | null;
    const p = Array.isArray(rel) ? rel[0] : rel;
    const caps = (m.capabilities ?? {}) as Record<string, unknown>;

    // local_worker_only sağlayıcı Vercel'den çağrılamaz; SSRF guard'ı bu
    // işareti koyduysa burada atlanır ve yedeğe düşülür.
    if (p?.network_scope === "local_worker_only" && process.env.VERCEL) continue;

    chain.push({
      modelId: String(m.model_id),
      modelKey: String(m.model_key),
      displayName: (m.display_name as string | null) ?? String(m.model_key),
      family: m.family as ModelFamily,
      jsonTier: (caps.json_schema as JsonModeTier) ?? "prompt",
      maxOutput: Number(caps.max_output ?? 8192),
      providerId: String(m.provider_id),
      providerLabel: p?.label ?? "?",
      networkScope: p?.network_scope ?? "public",
      pricing: (m.pricing ?? null) as RouteCandidate["pricing"],
    });
  }

  if (chain.length === 0) {
    throw new Error(`${step} adımının modeli bulunamadı ya da bu ortamdan çağrılamıyor.`);
  }
  return { step, chain };
}

export interface StructuredRequest<S extends z.ZodTypeAny> {
  ownerId: string;
  runId: string;
  motionId?: string | null;
  jobId?: string | null;
  step: PipelineStep;
  system: string;
  user: string;
  schema: S;
  /** Modele şemayı anlatan metin; şema adı ve alan açıklaması. */
  schemaHint: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Tüm zincir için toplam süre bütçesi. Fonksiyonun kendi sınırının
   * altında kalmalı; varsayılan Hobby planının 60 sn'sine göre seçildi.
   */
  budgetMs?: number;
}

/**
 * Şemaya uyan çıktı üretene kadar sırayla dener:
 *   1. Zincirdeki her model (birincil → yedekler)
 *   2. Her modelde bir onarım turu (Zod hatası modele geri verilir)
 *
 * Her deneme — başarılı ya da değil — attempts + step_traces'e yazılır.
 * Panelde görünmeyen bir çağrı olmamalı; "neden bu çıktı geldi" sorusu
 * ancak gönderilen metni görebiliyorsan cevaplanır.
 */
export async function callStructured<S extends z.ZodTypeAny>(
  req: StructuredRequest<S>
): Promise<z.output<S>> {
  const route = await resolveRoute(req.step, req.ownerId);
  const errors: string[] = [];

  // Canlıda görülen arıza: birincil model her çağrıda zaman aşımına
  // düşüyor, sabit 50 sn'lik timeout fonksiyonun tüm ömrünü yiyor ve
  // yedek modele sıra geldiğinde iş yarıda kesiliyordu — ne sonuç ne de
  // hata kaydı kalıyor, iş RUNNING'de asılı kalıyordu.
  // Artık bütçe zincire paylaştırılıyor.
  const deadline = Date.now() + (req.budgetMs ?? 52_000);

  for (let i = 0; i < route.chain.length; i++) {
    const model = route.chain[i];
    const provider = await loadProvider(model.providerId, req.ownerId);

    let messages: ChatMessage[] = [
      { role: "system", content: `${req.system}\n\n${schemaInstruction(req.schemaHint)}` },
      { role: "user", content: req.user },
    ];

    // İlk deneme + bir onarım turu. İkiden fazlası maliyeti katlıyor ve
    // pratikte düzelmiyor; düzelmiyorsa model yanlış seçilmiş demektir.
    for (let repair = 0; repair <= 1; repair++) {
      const timeoutMs = attemptTimeout(deadline, i, route.chain.length);
      if (timeoutMs === null) {
        errors.push("süre bütçesi tükendi");
        return failOutOfBudget(req, errors);
      }

      const started = Date.now();
      let raw = "";
      try {
        const out = await chatComplete({
          provider,
          modelKey: model.modelKey,
          messages,
          jsonMode: model.jsonTier !== "prompt",
          temperature: req.temperature ?? 0.2,
          maxTokens: Math.min(req.maxTokens ?? 8192, model.maxOutput),
          timeoutMs,
        });
        raw = out.text;

        const parsed = req.schema.safeParse(extractJson(raw));
        const cost = estimateCost(model, out.usage);

        await recordAttempt({
          ownerId: req.ownerId, runId: req.runId, motionId: req.motionId, jobId: req.jobId,
          step: req.step,
          providerId: model.providerId, providerLabel: model.providerLabel,
          modelKey: model.modelKey,
          fallbackIndex: i, jsonModeTier: model.jsonTier, schemaRepairCount: repair,
          latencyMs: Date.now() - started,
          usage: out.usage, costUsd: cost,
          result: parsed.success ? "ok" : "schema_fail",
          errorCode: parsed.success ? null : "schema_fail",
          errorText: parsed.success ? null : formatZod(parsed.error),
          request: { messages, model: model.modelKey, temperature: req.temperature ?? 0.2 },
          responseText: raw,
          responseJson: parsed.success ? parsed.data : null,
        });

        if (parsed.success) return parsed.data;

        const detail = formatZod(parsed.error);
        errors.push(`${model.displayName}: ${detail}`);
        if (repair === 0) {
          // Onarım turu: hatayı modele göster, tüm çıktıyı yeniden istet.
          messages = [
            ...messages,
            { role: "assistant", content: raw.slice(0, 4000) },
            {
              role: "user",
              content:
                `Çıktın şemaya uymadı:\n${detail}\n\n` +
                "Yalnızca düzeltilmiş JSON nesnesini döndür. Açıklama, kod bloğu işareti ekleme.",
            },
          ];
        }
      } catch (e) {
        const err = e as Error;
        await recordAttempt({
          ownerId: req.ownerId, runId: req.runId, motionId: req.motionId, jobId: req.jobId,
          step: req.step,
          providerId: model.providerId, providerLabel: model.providerLabel,
          modelKey: model.modelKey,
          fallbackIndex: i, jsonModeTier: model.jsonTier, schemaRepairCount: repair,
          latencyMs: Date.now() - started,
          result: err.name === "TimeoutError" ? "timeout" : "provider_error",
          errorCode: err.name,
          errorText: err.message,
          request: { messages, model: model.modelKey },
          responseText: raw || null,
        });
        errors.push(`${model.displayName}: ${err.message}`);
        break; // Sağlayıcı hatasında onarım anlamsız; yedeğe geç.
      }
    }
  }

  throw new Error(`${req.step} şemaya uyan çıktı üretemedi. ${errors.join(" | ")}`);
}

/**
 * Bir denemeye ne kadar süre verileceği.
 *
 * Arkasında yedek varsa üst sınır düşük tutuluyor: takılan bir birincil
 * modelin bütün bütçeyi yutup yedeği zamansız bırakması, yedeğin var
 * olma sebebini ortadan kaldırıyor. Son adayda kalan bütçenin tamamı
 * kullanılabilir. Bütçe bittiyse null döner ve zincir temiz durur.
 */
function attemptTimeout(deadline: number, index: number, total: number): number | null {
  const remaining = deadline - Date.now() - 2_000; // kayıt yazmaya pay
  if (remaining < 5_000) return null;
  const hasFallback = index < total - 1;
  return Math.min(hasFallback ? 20_000 : 45_000, remaining);
}

function failOutOfBudget(
  req: { step: PipelineStep },
  errors: string[]
): never {
  throw new Error(
    `${req.step} süre bütçesi içinde tamamlanamadı. ${errors.join(" | ")}`
  );
}

/* ------------------------------------------------------------ yardımcı */

function schemaInstruction(hint: string): string {
  return [
    "ÇIKTI KURALI: Yalnızca tek bir JSON nesnesi döndür.",
    "Markdown kod bloğu, açıklama, ön söz veya son söz ekleme.",
    // Canlıda görülen davranış: uzun dizilerde model ilk maddeleri eksiksiz
    // yazıyor, sonrakilerde alan atlamaya başlıyor. Kuralı açıkça söylemek
    // bunu belirgin biçimde azaltıyor.
    "Dizilerdeki HER öğe şemadaki TÜM alanları içermeli — ilk öğe kadar",
    "sonuncusu da eksiksiz olmalı. Bir alanın değeri yoksa null yaz;",
    "alanı atlamak geçersizdir.",
    "Beklenen yapı:",
    hint,
  ].join("\n");
}

/**
 * Model kod bloğu içinde ya da açıklamayla sarılı döndürebiliyor.
 * En dıştaki JSON nesnesini çıkarıyoruz — şema doğrulaması zaten
 * arkasından geliyor, burada gevşek olmak güvenli.
 */
function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function formatZod(error: z.ZodError): string {
  return error.issues
    .slice(0, 12)
    .map((i) => `${i.path.join(".") || "(kök)"}: ${i.message}`)
    .join("; ");
}

function estimateCost(
  model: RouteCandidate,
  usage: { input_tokens?: number; output_tokens?: number } | null
): number {
  if (!usage || !model.pricing) return 0;
  const inRate = Number(model.pricing.input_per_mtok ?? 0) / 1e6;
  const outRate = Number(model.pricing.output_per_mtok ?? 0) / 1e6;
  return (usage.input_tokens ?? 0) * inRate + (usage.output_tokens ?? 0) * outRate;
}

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainQueue, isDraining } from "./runner";
import type { JobType } from "./machine";

export interface EnqueueInput {
  ownerId: string;
  runId: string;
  motionId?: string | null;
  jobType: JobType;
  payload?: Record<string, unknown>;
  priority?: number;
  delaySeconds?: number;
}

/**
 * İki mekanizma birlikte çalışır:
 *   1. Kuyruğa yaz  → kalıcı, kaybolmaz
 *   2. Anında tetikle → kullanıcı cron'u beklemesin
 * Tetikleme kaçarsa cron zaten toplar — ama Hobby planında cron günde
 * bir çalıştığı için "kaçarsa" pratikte "ertesi güne kalır" demek.
 * Tetiklemenin gerçekten çalışması gerekiyor.
 */
export async function enqueue(input: EnqueueInput): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("jobs")
    .insert({
      owner_id: input.ownerId,
      run_id: input.runId,
      motion_id: input.motionId ?? null,
      job_type: input.jobType,
      payload_json: input.payload ?? {},
      priority: input.priority ?? 0,
      scheduled_for: new Date(Date.now() + (input.delaySeconds ?? 0) * 1000).toISOString(),
    })
    .select("job_id")
    .single();

  if (error) throw new Error(`Job kuyruğa alınamadı: ${error.message}`);

  if (!input.delaySeconds) scheduleKick(input.jobType);
  return data.job_id as string;
}

/**
 * `void kick()` serverless'ta güvenilir değildi: yanıt döndükten sonra
 * invocation donduruluyor ve bekleyen fetch hiç gitmiyor. Gözlenen sonuç
 * buydu — iş QUEUED'da kalıyor, /api/jobs/* loglarında hiç görünmüyordu.
 * after() işi yanıttan sonraya alır ama invocation'ı canlı tutar.
 *
 * İstek bağlamı yoksa (zaten bir drain'in içindeysek) after() fırlatır;
 * o durumda tetiklemeyi doğrudan yürütüyoruz.
 */
function scheduleKick(jobType: JobType): void {
  try {
    after(() => kick(jobType));
  } catch {
    void kick(jobType);
  }
}

/**
 * Önce ayrı bir invocation denenir: iş orada kendi maxDuration'ı ile
 * çalışır, bu isteği bekletmez. Ulaşılamazsa iş burada yürütülür —
 * kuyruğun ilerlemesi deployment koruma ayarına bağlı kalmamalı.
 */
async function kick(jobType: JobType): Promise<void> {
  if (await kickOverHttp(jobType)) return;

  // Bir drain zaten sürüyorsa buradan yenisini başlatmıyoruz; o drain'in
  // döngüsü yeni işi kendi turunda alacak. Aksi halde tek invocation
  // içinde özyineleme olur.
  if (isDraining()) return;

  // Zincirin ilerlemesi için birkaç tur: PLAN_CLAIMS'in kuyruğa yazdığı
  // işi aynı invocation'da alabilelim. Sınırlı, çünkü invocation ömrü de
  // sınırlı; kalanı cron toplar.
  for (let round = 0; round < 5; round++) {
    try {
      const result = await drainQueue({ workerId: `inline-${jobType}` });
      if (result.claimed === 0) return;
    } catch {
      return; // Kuyruk kalıcı; bir sonraki tetikleme veya cron toparlar.
    }
  }
}

/** Ulaşıldıysa true. */
async function kickOverHttp(jobType: JobType): Promise<boolean> {
  const base = resolveBase();
  if (!base) return false;

  const headers: Record<string, string> = {
    "x-cron-secret": process.env.CRON_SECRET ?? "",
  };
  // Vercel Authentication açıkken kendi kendine yapılan çağrı da giriş
  // duvarına takılır. Protection Bypass for Automation açıksa Vercel bu
  // değişkeni kendisi enjekte eder ve duvarı bu başlık deler.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) {
    headers["x-vercel-protection-bypass"] = bypass;
    headers["x-vercel-set-bypass-cookie"] = "false";
  }

  try {
    const res = await fetch(`${base}/api/jobs/${jobType}`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(3000),
    });
    // 2xx: iş karşı tarafta alındı. 401/404/5xx: ulaşamadık (koruma
    // duvarı buraya düşer), inline yedeğe geçilir.
    return res.ok;
  } catch (e) {
    // Zaman aşımı, route'un işi yürüttüğü anlamına gelir — ulaşıldı.
    // Gerçek ağ hatası ulaşılamadı demektir.
    return isTimeout(e);
  }
}

function resolveBase(): string | null {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.NODE_ENV === "production" ? null : "http://localhost:3000";
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

export async function logEvent(args: {
  ownerId: string; runId: string; motionId?: string | null;
  eventType: string; prevState?: string | null; newState?: string | null;
  message?: string; metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = createAdminClient();
  await db.from("events").insert({
    owner_id: args.ownerId,
    run_id: args.runId,
    motion_id: args.motionId ?? null,
    event_type: args.eventType,
    prev_state: args.prevState ?? null,
    new_state: args.newState ?? null,
    message: args.message ?? null,
    metadata_json: args.metadata ?? {},
  });
}

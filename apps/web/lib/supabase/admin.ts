import { createClient } from "@supabase/supabase-js";

/**
 * Service role istemcisi: RLS'i bypass eder.
 * YALNIZ job handler'ları, cron route'u ve yönetim ekranları kullanır.
 * Hiçbir Client Component'e sızmamalı — bu dosya asla "use client" içermez.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY tanımlı değil");

  const problem = serviceRoleProblem();
  if (problem) throw new Error(`SUPABASE_SERVICE_ROLE_KEY yanlış: ${problem}`);

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Buraya yanlışlıkla publishable/anon anahtar konması sessizce yanlış
 * çalışan bir sistem üretiyor: okumalar RLS altında boş sonuç dönüp 200
 * verdiği için her şey yolunda görünüyor, ama ilk yazma denemesi
 * "new row violates row-level security policy" ile patlıyor ve hata
 * anahtarı değil politikayı işaret ediyor. Yanlış yeri saatlerce aratan
 * cinsten bir hata; girişte yakalayıp adıyla söylüyoruz.
 *
 * Sorun varsa açıklamasını, yoksa null döner. Yönetim ekranları bunu
 * doğrudan çağırıp 500 yerine anlaşılır bir sayfa gösteriyor.
 */
export function serviceRoleProblem(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return "tanımlı değil.";
  if (key.startsWith("sb_publishable_")) {
    return "bu bir publishable (tarayıcı) anahtarı. Supabase → Settings → API Keys ekranındaki service_role / secret anahtarını gir.";
  }
  if (key.startsWith("sb_secret_")) return null;

  // Eski biçim: rolü JWT payload'ında yazıyor.
  const payload = decodeJwtPayload(key);
  if (!payload) return null; // Tanımadığımız biçim — kararı Supabase versin.

  const role = typeof payload.role === "string" ? payload.role : null;
  if (role && role !== "service_role") {
    return `anahtarın rolü "${role}", "service_role" olmalı. Supabase → Settings → API Keys ekranındaki service_role / secret anahtarını gir.`;
  }
  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

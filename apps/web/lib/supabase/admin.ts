import { createClient } from "@supabase/supabase-js";

/**
 * Service role istemcisi: RLS'i bypass eder.
 * YALNIZ job handler'ları ve cron route'u kullanır. Hiçbir Client
 * Component'e sızmamalı — bu dosya asla "use client" içermez.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY tanımlı değil");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

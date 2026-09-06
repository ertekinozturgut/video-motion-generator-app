import { createClient } from "@/lib/supabase/server";

export interface AdminSession {
  userId: string;
  email: string;
}

/**
 * Provider ayarları anahtar yönetimi demek; yalnız admin rolü açar.
 * Rol veritabanındaki profiles tablosundan okunur, JWT metadata'sından değil —
 * metadata client tarafından değiştirilebiliyor.
 */
export async function getAdmin(): Promise<AdminSession | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if ((data as { role?: string } | null)?.role !== "admin") return null;
  return { userId: user.id, email: user.email ?? "" };
}

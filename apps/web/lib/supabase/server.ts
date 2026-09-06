import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { CookieToSet } from "./cookies";

/** Kullanıcı oturumuyla, RLS altında çalışan istemci. */
export async function createClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list: CookieToSet[]) => {
          try {
            list.forEach(({ name, value, options }) =>
              store.set(name, value, options as never)
            );
          } catch {
            // Server Component'ten çağrıldığında yazılamaz; middleware tazeliyor.
          }
        },
      },
    }
  );
}

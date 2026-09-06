import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";
import { getAdmin } from "@/lib/auth";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  let email: string | undefined;
  let admin = false;

  if (isConfigured()) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    email = user?.email;
    admin = user ? (await getAdmin()) !== null : false;
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4">
          <Link href="/" className="font-semibold tracking-tight">Video üretimi</Link>
          {email && (
            <Link href="/runs/new" className="text-sm text-muted hover:text-text">
              Yeni çalışma
            </Link>
          )}
          {admin && (
            <>
              <Link href="/settings/providers" className="text-sm text-muted hover:text-text">
                Sağlayıcılar
              </Link>
              <Link href="/settings/routing" className="text-sm text-muted hover:text-text">
                Model dağıtımı
              </Link>
            </>
          )}
          <span className="ml-auto text-sm text-muted">{email}</span>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";
import { getAdmin } from "@/lib/auth";
import { SignOut } from "@/components/SignOut";

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
      <header className="sticky top-0 z-20 border-b border-line bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3.5">
          <Link href="/" className="font-semibold tracking-tight">
            Video üretimi
          </Link>

          {email && (
            <nav className="flex items-center gap-x-5">
              <Link href="/" className="text-sm text-muted transition-colors hover:text-text">
                Çalışmalar
              </Link>
              <Link href="/runs/new" className="text-sm text-muted transition-colors hover:text-text">
                Yeni çalışma
              </Link>
              {admin && (
                <Link href="/settings" className="text-sm text-muted transition-colors hover:text-text">
                  Yönetim
                </Link>
              )}
            </nav>
          )}

          {email && (
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-sm text-muted sm:block">{email}</span>
              <SignOut />
            </div>
          )}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

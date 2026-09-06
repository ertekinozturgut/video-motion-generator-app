"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      onClick={async () => {
        setBusy(true);
        await createClient().auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      disabled={busy}
      className="text-sm text-muted transition-colors hover:text-text disabled:opacity-40"
    >
      {busy ? "Çıkılıyor" : "Çıkış"}
    </button>
  );
}

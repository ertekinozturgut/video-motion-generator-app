"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(formData.get("email")),
      password: String(formData.get("password")),
    });
    if (error) {
      setError("E-posta veya parola eşleşmedi.");
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <form action={submit} className="w-full max-w-sm space-y-5">
        <h1 className="text-xl font-semibold tracking-tight">Video üretim paneli</h1>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">E-posta</span>
          <input name="email" type="email" required autoComplete="email"
                 className="w-full rounded border border-line bg-panel px-3 py-2 text-sm" />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Parola</span>
          <input name="password" type="password" required autoComplete="current-password"
                 className="w-full rounded border border-line bg-panel px-3 py-2 text-sm" />
        </label>

        {error && (
          <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm">{error}</p>
        )}

        <button type="submit" disabled={busy}
                className="w-full rounded bg-text px-4 py-2.5 text-sm font-medium text-ink disabled:opacity-40">
          {busy ? "Giriş yapılıyor" : "Giriş yap"}
        </button>
      </form>
    </div>
  );
}

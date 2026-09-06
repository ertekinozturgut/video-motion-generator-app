const VARS: Array<[string, string]> = [
  ["NEXT_PUBLIC_SUPABASE_URL", "Supabase proje adresi"],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "Tarayıcı anahtarı"],
  ["SUPABASE_SERVICE_ROLE_KEY", "Sunucu anahtarı — job handler'ları ve yönetim ekranları kullanır. Asla NEXT_PUBLIC olmaz."],
  ["PROVIDER_ENC_KEY_V1", "openssl rand -base64 32 — sağlayıcı anahtarlarını çözen master anahtar"],
  ["PROVIDER_ENC_KEY_CURRENT", "1"],
  ["CRON_SECRET", "openssl rand -hex 32 — cron ve dispatch çağrılarını korur"],
];

const STEPS = [
  "Supabase'de yeni bir proje aç.",
  "supabase db push ile 0001 → 0004 migration'larını uygula.",
  "Authentication → Users bölümünden kendine bir kullanıcı ekle, profiles tablosunda role='admin' yap.",
  "Aşağıdaki değişkenleri Vercel → Settings → Environment Variables altına gir ve yeniden dağıt.",
];

export function Setup() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-3 text-xl font-semibold tracking-tight">Kuruluma devam et</h1>
      <p className="mb-8 text-sm leading-relaxed text-muted">
        Panel yayında ama henüz bir veritabanına bağlı değil. Supabase projesini
        oluşturup aşağıdaki değişkenleri ekle, sonra yeniden dağıt.
      </p>

      <ol className="mb-10 space-y-3">
        {STEPS.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm leading-relaxed">
            <span className="tnum shrink-0 text-muted">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>

      <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
        {VARS.map(([name, note]) => (
          <li key={name} className="px-5 py-3.5">
            <div className="tnum text-sm">{name}</div>
            <div className="mt-0.5 text-sm leading-relaxed text-muted">{note}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const VARS = [
  ["NEXT_PUBLIC_SUPABASE_URL", "Supabase proje adresi"],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "Tarayıcı anahtarı"],
  ["SUPABASE_SERVICE_ROLE_KEY", "Sunucu anahtarı — job handler'ları kullanır"],
  ["CRON_SECRET", "Cron ve dispatch çağrılarını korur"],
  ["PROVIDER_ENC_KEY_V1", "openssl rand -base64 32"],
];

export function Setup() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">Kuruluma devam et</h1>
      <p className="mb-8 text-muted">
        Panel yayında ama henüz bir veritabanına bağlı değil. Supabase projesini
        oluşturup aşağıdaki değişkenleri Vercel&apos;e ekle, sonra yeniden dağıt.
      </p>

      <ol className="mb-10 space-y-4 text-sm">
        <li>Supabase&apos;de yeni bir proje aç.</li>
        <li>
          <code className="tnum text-attention">supabase db push</code> ile
          <code className="tnum"> 0001_init.sql</code> ve
          <code className="tnum"> 0002_rls_and_queue.sql</code> dosyalarını uygula.
        </li>
        <li>Authentication → Users bölümünden kendine bir kullanıcı ekle.</li>
        <li>Aşağıdaki değişkenleri Vercel proje ayarlarına gir.</li>
      </ol>

      <ul className="divide-y divide-line rounded border border-line bg-panel">
        {VARS.map(([name, note]) => (
          <li key={name} className="px-4 py-3">
            <div className="tnum text-sm text-text">{name}</div>
            <div className="text-sm text-muted">{note}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

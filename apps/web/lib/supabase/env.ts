/**
 * Supabase bağlantısı henüz kurulmadıysa uygulama çökmemeli, ne yapılması
 * gerektiğini söylemeli. Boş bir ekran yönlendirme fırsatıdır.
 */
export function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

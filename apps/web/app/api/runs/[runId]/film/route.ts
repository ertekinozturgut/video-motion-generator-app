import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Çalışmanın izlenebilir çıktısını HTML olarak verir.
 *
 * RLS altında kullanıcının kendi oturumuyla okunuyor: film satırı
 * artifacts tablosunda ve o tablo sahibine bağlı. Servis anahtarıyla
 * okusaydık, bağlantıyı bilen herkes filmi indirebilirdi.
 *
 * ?download=1 dosyayı kaydettirir; varsayılan tarayıcıda oynatır.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const motionId = request.nextUrl.searchParams.get("motion");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });

  let q = supabase
    .from("artifacts")
    .select("metadata_json,created_at")
    .eq("run_id", runId)
    .eq("artifact_type", motionId ? "scene" : "film")
    .order("created_at", { ascending: false })
    .limit(1);
  q = motionId ? q.eq("motion_id", motionId) : q.is("motion_id", null);

  const { data } = await q.maybeSingle();
  const html = (data as { metadata_json?: { html?: string } } | null)?.metadata_json?.html;

  if (!html) {
    return new NextResponse(
      "<!doctype html><meta charset=utf-8><body style=\"font:14px system-ui;background:#07090d;color:#8b97a8;padding:40px\">Bu çalışma için henüz çizilmiş bir sahne yok.</body>",
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Üretilen dosya kendi kaynağında çalışıyor; panelin oturumuna
      // erişmesi gerekmiyor ve gerekmemeli.
      "content-security-policy": "sandbox allow-scripts",
      "cache-control": "no-store",
      ...(download
        ? { "content-disposition": `attachment; filename="film-${runId.slice(0, 8)}.html"` }
        : {}),
    },
  });
}

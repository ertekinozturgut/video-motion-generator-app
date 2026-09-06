import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Kullanıcının girdiği base_url'lere karşı SSRF koruması.
 * Bu olmadan panel, sunucuya "şu adrese istek at" dedirtebilen bir yüzey açar.
 * En kritik hedef cloud metadata endpoint'i: 169.254.169.254.
 */
export interface UrlCheck {
  ok: boolean;
  reason?: string;
  suggestedScope: "public" | "local_worker_only";
}

const BLOCKED = new Set(["localhost", "metadata.google.internal", "metadata.goog"]);

function privateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return true;
  const a = p[0]!, b = p[1]!;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;              // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;    // CGNAT
  if (a >= 224) return true;
  return false;
}

function privateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
  if (v.startsWith("::ffff:")) return privateV4(v.slice(7));
  return false;
}

export async function checkBaseUrl(raw: string): Promise<UrlCheck> {
  let url: URL;
  try { url = new URL(raw); }
  catch { return { ok: false, reason: "Geçersiz adres", suggestedScope: "public" }; }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Yalnız http/https", suggestedScope: "public" };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return {
      ok: false,
      reason: "Yerel adres — bu provider yalnız local worker ile kullanılabilir",
      suggestedScope: "local_worker_only",
    };
  }

  let ips: string[];
  if (isIP(host)) ips = [host];
  else {
    try { ips = (await lookup(host, { all: true })).map((r) => r.address); }
    catch { return { ok: false, reason: "Adres çözümlenemedi", suggestedScope: "public" }; }
  }

  // DNS rebinding'e karşı hostname değil çözümlenen IP kontrol edilir.
  if (ips.some((ip) => (isIP(ip) === 6 ? privateV6(ip) : privateV4(ip)))) {
    return {
      ok: false,
      reason: "Özel/dahili IP aralığı — Vercel'den çağrılamaz",
      suggestedScope: "local_worker_only",
    };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "Dış adresler için https zorunlu", suggestedScope: "public" };
  }
  return { ok: true, suggestedScope: "public" };
}

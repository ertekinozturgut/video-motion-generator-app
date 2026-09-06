import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Kullanıcı tarafından girilen base_url'lere (OmniRoute, self-hosted kurulumlar)
 * karşı SSRF koruması.
 *
 * Bu olmadan panel, sunucuya "şu adrese istek at" dedirtebilen bir yüzey açar.
 * En kritik hedef cloud metadata endpoint'i: 169.254.169.254 — oradan
 * instance credential'ları okunabilir.
 */

export type NetworkScope = "public" | "local_worker_only";

export interface UrlCheckResult {
  ok: boolean;
  reason?: string;
  /** Private adres tespit edilirse provider otomatik bu kapsama düşer. */
  suggestedScope: NetworkScope;
  resolvedIps: string[];
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true; // parse edemiyorsak güvenme
  const [a, b] = p;
  if (a === 10) return true;                        // 10/8
  if (a === 127) return true;                       // loopback
  if (a === 0) return true;                         // 0/8
  if (a === 169 && b === 254) return true;          // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true;          // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT
  if (a >= 224) return true;                        // multicast + reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
  if (v.startsWith("fe80")) return true;                     // link-local
  if (v.startsWith("::ffff:")) return isPrivateV4(v.slice(7)); // IPv4-mapped
  return false;
}

function isPrivate(ip: string): boolean {
  return isIP(ip) === 6 ? isPrivateV6(ip) : isPrivateV4(ip);
}

/**
 * DNS rebinding'e karşı hostname değil, ÇÖZÜMLENEN IP kontrol edilir.
 * Çağıran taraf ayrıca isteği bu IP'ye pinlemeli (agent lookup override).
 */
export async function checkProviderBaseUrl(raw: string): Promise<UrlCheckResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Geçersiz URL", suggestedScope: "public", resolvedIps: [] };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Yalnız http/https", suggestedScope: "public", resolvedIps: [] };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return {
      ok: false,
      reason: "Yerel adres — bu provider yalnız local worker ile kullanılabilir",
      suggestedScope: "local_worker_only",
      resolvedIps: [],
    };
  }

  let ips: string[];
  if (isIP(host)) {
    ips = [host];
  } else {
    try {
      ips = (await lookup(host, { all: true })).map((r) => r.address);
    } catch {
      return { ok: false, reason: "Host çözümlenemedi", suggestedScope: "public", resolvedIps: [] };
    }
  }

  // TEK BİR private IP bile yeterli: round-robin DNS ile karışık dönebilir.
  if (ips.some(isPrivate)) {
    return {
      ok: false,
      reason: "Özel/dahili IP aralığı — Vercel'den çağrılamaz",
      suggestedScope: "local_worker_only",
      resolvedIps: ips,
    };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "Public adresler için https zorunlu", suggestedScope: "public", resolvedIps: ips };
  }

  return { ok: true, suggestedScope: "public", resolvedIps: ips };
}

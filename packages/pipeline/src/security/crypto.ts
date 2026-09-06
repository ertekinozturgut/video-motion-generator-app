import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Provider API anahtarları için AES-256-GCM.
 *
 * Master anahtar Vercel env'inde tutulur, Supabase'de DEĞİL. Böylece
 * veritabanı ele geçse bile şifreli metin çözülemez — iki ayrı sistemin
 * birden düşmesi gerekir.
 *
 * Env formatı (rotasyonu desteklemek için versiyonlu):
 *   PROVIDER_ENC_KEY_V1=<base64, 32 byte>
 *   PROVIDER_ENC_KEY_V2=<base64, 32 byte>   (rotasyon sırasında)
 *   PROVIDER_ENC_KEY_CURRENT=2
 */

const ALGO = "aes-256-gcm";

export interface SealedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
  last4: string;
}

function loadKey(version: number): Buffer {
  const raw = process.env[`PROVIDER_ENC_KEY_V${version}`];
  if (!raw) throw new Error(`PROVIDER_ENC_KEY_V${version} tanımlı değil`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`PROVIDER_ENC_KEY_V${version} 32 byte olmalı (base64)`);
  }
  return key;
}

function currentVersion(): number {
  const v = Number(process.env.PROVIDER_ENC_KEY_CURRENT ?? "1");
  if (!Number.isInteger(v) || v < 1) throw new Error("PROVIDER_ENC_KEY_CURRENT geçersiz");
  return v;
}

export function sealSecret(plaintext: string): SealedSecret {
  if (!plaintext || plaintext.length < 8) {
    throw new Error("API anahtarı çok kısa görünüyor");
  }
  const keyVersion = currentVersion();
  const key = loadKey(keyVersion);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext,
    iv,
    authTag: cipher.getAuthTag(),
    keyVersion,
    last4: plaintext.slice(-4),
  };
}

export function openSecret(sealed: Omit<SealedSecret, "last4">): string {
  const key = loadKey(sealed.keyVersion);
  const decipher = createDecipheriv(ALGO, key, sealed.iv);
  decipher.setAuthTag(sealed.authTag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
}

/** Anahtarın panelde/loglarda görünecek tek hali. */
export function maskKey(last4: string): string {
  return `••••••••${last4}`;
}

/**
 * Rotasyon: eski versiyonla çöz, yeni versiyonla mühürle.
 * Eski anahtarı env'den kaldırmadan önce tüm kayıtlar dönüştürülmüş olmalı.
 */
export function rotateSecret(sealed: Omit<SealedSecret, "last4">): SealedSecret {
  return sealSecret(openSecret(sealed));
}

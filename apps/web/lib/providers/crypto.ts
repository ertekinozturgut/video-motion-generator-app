import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Provider API anahtarları için AES-256-GCM.
 * Master anahtar Vercel env'inde, Supabase'de DEĞİL. Veritabanı ele geçse
 * bile şifreli metin çözülemez; iki ayrı sistemin birden düşmesi gerekir.
 */
const ALGO = "aes-256-gcm";

export interface Sealed {
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
  if (key.length !== 32) throw new Error(`PROVIDER_ENC_KEY_V${version} 32 byte olmalı`);
  return key;
}

function currentVersion(): number {
  return Number(process.env.PROVIDER_ENC_KEY_CURRENT ?? "1");
}

export function seal(plaintext: string): Sealed {
  if (!plaintext || plaintext.length < 8) throw new Error("API anahtarı çok kısa görünüyor");
  const keyVersion = currentVersion();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, loadKey(keyVersion), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion, last4: plaintext.slice(-4) };
}

export function open(sealed: {
  ciphertext: Buffer; iv: Buffer; authTag: Buffer; keyVersion: number;
}): string {
  const d = createDecipheriv(ALGO, loadKey(sealed.keyVersion), sealed.iv);
  d.setAuthTag(sealed.authTag);
  return Buffer.concat([d.update(sealed.ciphertext), d.final()]).toString("utf8");
}

/** Postgres bytea <-> Buffer. supabase-js bytea'yı \x hex string olarak döner. */
export const toHex = (b: Buffer) => `\\x${b.toString("hex")}`;
export const fromHex = (s: string) => Buffer.from(s.replace(/^\\x/, ""), "hex");

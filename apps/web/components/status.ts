/**
 * Durum → renk eşlemesi tek yerde.
 * Amber yalnız insan müdahalesi bekleyen durumlara ayrıldı; bir izleme
 * panelinde dikkat çekmesi gereken tek şey o.
 */
export const RUN_TONE: Record<string, string> = {
  RECEIVED: "idle", CLAIMS_CHECKED: "active",
  AWAITING_APPROVAL: "attention", APPROVED_FOR_PLANNING: "active",
  PLAN_QA: "active", READY: "active", RUNNING: "active",
  COMPLETED: "good", NEEDS_HUMAN: "attention",
  APPROVAL_TIMEOUT: "attention", FAILED_TECHNICAL: "bad", CANCELLED: "idle",
};

export const MOTION_TONE: Record<string, string> = {
  READY: "idle", ASSET_READY: "active", SPEC_VALIDATED: "active",
  RENDERED: "active", QA_APPROVED: "good", UPLOADED: "good",
  NEEDS_REVISION: "attention", NEEDS_HUMAN: "attention",
  FAILED_TECHNICAL: "bad", SKIPPED: "idle",
};

export const RUN_LABEL: Record<string, string> = {
  RECEIVED: "Alındı", CLAIMS_CHECKED: "Bilgiler kontrol edildi",
  AWAITING_APPROVAL: "Onay bekliyor", APPROVED_FOR_PLANNING: "Planlanıyor",
  PLAN_QA: "Plan kontrolü", READY: "Hazır", RUNNING: "Üretiliyor",
  COMPLETED: "Tamamlandı", NEEDS_HUMAN: "Müdahale gerekiyor",
  APPROVAL_TIMEOUT: "Onay süresi doldu", FAILED_TECHNICAL: "Teknik hata",
  CANCELLED: "İptal edildi",
};

export const MOTION_LABEL: Record<string, string> = {
  READY: "Sırada", ASSET_READY: "Görseller hazır", SPEC_VALIDATED: "Spec doğrulandı",
  RENDERED: "Render edildi", QA_APPROVED: "Kontrolden geçti", UPLOADED: "Yüklendi",
  NEEDS_REVISION: "Revizyon gerekiyor", NEEDS_HUMAN: "Müdahale gerekiyor",
  FAILED_TECHNICAL: "Teknik hata", SKIPPED: "Atlandı",
};

export const TONE_BG: Record<string, string> = {
  idle: "bg-idle", active: "bg-active", good: "bg-good",
  attention: "bg-attention", bad: "bg-bad",
};

export const TONE_TEXT: Record<string, string> = {
  idle: "text-muted", active: "text-active", good: "text-good",
  attention: "text-attention", bad: "text-bad",
};

export function timecode(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

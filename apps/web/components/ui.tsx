/**
 * Panel genelinde paylaşılan yüzey parçaları.
 *
 * Tek bir kural var: renk bilgi taşır. Amber yalnız insan müdahalesi
 * bekleyen duruma, kırmızı yalnız teknik hataya ayrıldı. Bir yönetim
 * ekranında her kutuyu renklendirirsen hiçbiri fark edilmez.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export type Tone = "idle" | "active" | "good" | "attention" | "bad";

const TONE_DOT: Record<Tone, string> = {
  idle: "bg-idle", active: "bg-active", good: "bg-good",
  attention: "bg-attention", bad: "bg-bad",
};

const TONE_CHIP: Record<Tone, string> = {
  idle: "border-line text-muted",
  active: "border-active/40 text-active",
  good: "border-good/40 text-good",
  attention: "border-attention/40 text-attention",
  bad: "border-bad/40 text-bad",
};

/* ---------------------------------------------------------------- yüzeyler */

export function Card({
  children, className = "", ...rest
}: { children: ReactNode; className?: string } & ComponentProps<"section">) {
  return (
    <section
      {...rest}
      className={`rounded-lg border border-line bg-panel ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title, hint, action,
}: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-line px-5 py-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-1 text-sm leading-relaxed text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title, lede, action,
}: { title: string; lede?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-start gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {lede && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{lede}</p>}
      </div>
      {action}
    </header>
  );
}

/* -------------------------------------------------------------- göstergeler */

export function Dot({ tone }: { tone: Tone }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden />;
}

export function Chip({ tone = "idle", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${TONE_CHIP[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Sayı büyük, etiket küçük. Alt satır ("2 / 7 atandı" gibi) yalnız
 * gerçekten ikinci bir boyut varsa doldurulmalı.
 */
export function Stat({
  label, value, sub, tone = "idle", href,
}: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <Dot tone={tone} />
        <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      </div>
      <div className="tnum mt-2 text-2xl font-medium leading-none">{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </>
  );

  const cls =
    "block rounded-lg border border-line bg-panel px-4 py-4 transition-colors";
  return href
    ? <Link href={href} className={`${cls} hover:border-line hover:bg-raised`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

/** Hazır mı, değil mi — kurulum ekranındaki tek satırlık gerçek. */
export function CheckRow({
  ok, title, detail, action,
}: { ok: boolean; title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-5 py-3.5">
      <span className="mt-1.5"><Dot tone={ok ? "good" : "attention"} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm">{title}</div>
        {detail && <div className="mt-0.5 text-sm text-muted">{detail}</div>}
      </div>
      {action}
    </li>
  );
}

export function EmptyState({
  title, detail, action,
}: { title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-panel/50 px-6 py-10 text-center">
      <p className="text-sm">{title}</p>
      {detail && <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{detail}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ girdiler */

export const btn = {
  primary:
    "inline-flex items-center justify-center rounded-md bg-text px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40",
  ghost:
    "inline-flex items-center justify-center rounded-md border border-line px-3 py-1.5 text-sm text-text transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40",
  quiet:
    "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-40",
  danger:
    "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-bad disabled:cursor-not-allowed disabled:opacity-40",
};

export const field =
  "w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-text transition-colors placeholder:text-muted/60 focus:border-active/60";

export function Field({
  label, hint, children,
}: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

/** Kaydedildi / kaydedilemedi geri bildirimi. Sessizce başarısız olmasın. */
export function Notice({ tone, children }: { tone: Tone; children: ReactNode }) {
  const map: Record<Tone, string> = {
    idle: "border-line bg-raised",
    active: "border-active/40 bg-active/10",
    good: "border-good/40 bg-good/10",
    attention: "border-attention/40 bg-attention/10",
    bad: "border-bad/40 bg-bad/10",
  };
  return (
    <p role="status" className={`rounded-md border px-3.5 py-2.5 text-sm ${map[tone]}`}>
      {children}
    </p>
  );
}

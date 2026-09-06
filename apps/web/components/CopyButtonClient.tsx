"use client";

import { useState } from "react";

export function CopyButtonClient({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      className="rounded-md border border-line px-2 py-1 text-xs text-muted transition-colors hover:bg-raised hover:text-text"
    >
      {copied ? "Kopyalandı" : label}
    </button>
  );
}

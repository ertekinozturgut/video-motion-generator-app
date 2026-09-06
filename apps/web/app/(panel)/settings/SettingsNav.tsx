"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/settings", label: "Genel bakış", note: "Sistem hazır mı" },
  { href: "/settings/providers", label: "Sağlayıcılar", note: "Anahtarlar, bağlantı" },
  { href: "/settings/routing", label: "Model dağıtımı", note: "Adım → model" },
  { href: "/settings/queue", label: "Kuyruk", note: "İşler, hatalar" },
];

export function SettingsNav() {
  const path = usePathname();

  return (
    <nav>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible">
        {ITEMS.map((item) => {
          // "/settings" her şeyin öneki; genel bakış yalnız tam eşleşmede aktif.
          const active =
            item.href === "/settings" ? path === "/settings" : path.startsWith(item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                  active ? "bg-raised text-text" : "text-muted hover:bg-raised/60 hover:text-text"
                }`}
              >
                {item.label}
                <span className="hidden text-xs text-muted lg:block">{item.note}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

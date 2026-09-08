# Agent Squad — Video Üretim Paneli uyarlaması

Bu klasör [ertekinozturgut/agent-squad](https://github.com/ertekinozturgut/agent-squad) mimarisinin bu projeye uyarlanmış kopyasıdır. Kaynak depoya dokunulmadı; buradaki değişiklikler yalnız bu projede geçerli.

## Ne değişti

Kaynak squad .NET 10 / ASP.NET Core MVC / Razor / Bootstrap 5.3 / EF Core / xUnit üzerine kuruluydu. Bu proje Next.js 15 App Router / TypeScript / Supabase (Postgres + RLS) / Tailwind v4 / Postgres iş kuyruğu / LLM boru hattı üzerine kurulu. Disiplin aynı kaldı, yığın değişti:

| Dosya | Durum |
| :--- | :--- |
| `skills/backend-engineer` | **Yeniden yazıldı** — TypeScript, route handler, Supabase erişimi, kuyruk adımları, Zod, LLM katmanı |
| `skills/razor-specialist` → `skills/frontend-engineer` | **Yeniden yazıldı** — App Router sunucu/istemci sınırı, `ui.tsx` primitifleri, tasarım token'ları |
| `skills/solution-architect` | Katman diyagramı, şema sözleşmesi kararları, durum makinesi ve kuyruk sözleşmesi bu projeye göre |
| `skills/uiux-designer` | Bootstrap token tablosu → projenin renk sözleşmesi; durum matrisi `btn.*` davranışına göre |
| `skills/qa-tester` | xUnit şablonları → şema, durum makinesi, guard, enjeksiyon ve tarayıcı doğrulama şablonları |
| `skills/security-reviewer` | CSRF/`@Html.Raw`/EF Core → service role sınırı, RLS/IDOR, üretilen HTML'de kaçışlama, SSRF, sessiz yutma |
| `skills/project-manager`, `skills/business-analyst` | Yığından bağımsız; yalnız kapı metinleri güncellendi |
| `rules/01-squad-handoff-protocol.md` | DoD kapısı `tsc --noEmit` + `next build` + kontroller; bozuk Windows yolu düzeltildi |
| `rules/02-architecture-invariants.md` | **Yeniden yazıldı** — katman sınırları ve bu projenin on değişmezi |
| `rules/03-security-guardrails.md` | **Yeniden yazıldı** — Supabase, üretilen dosya güvenliği, sır yönetimi |
| `rules/04-ui-design-invariants.md` | **Yeniden yazıldı** — token'lar, renk sözleşmesi, UX değişmezleri |
| `rules/05-backend-development-clean-code-standards.md` | **Yeniden yazıldı** — aynı Clean Code kuralları, TypeScript örnekleriyle |

## Bu projeye eklenen değişmezler

Kaynak squad'da olmayan, bu projenin kendi arızalarından öğrenilmiş kurallar:

1. **Karar kodda, LLM'de değil.** Model içerik üretir; akış kararını durum makinesi verir.
2. **Ölçülebilen yargıya bırakılmaz.** Çakışma, taşma, süre uyuşmazlığı kodla ölçülür; QA modeline anlam kusurları kalır.
3. **Eksik güvenlik alanı güvenli yöne düşer.** `risk` yoksa `high`, `needs_review` yoksa `true`.
4. **Determinizm QA'nın önkoşuludur.** Denetlenen tarif ile yayınlanan dosya aynı kaynaktan çıkar.
5. **İçerik kusuru exception değildir.** Yeniden deneme aynı sonuca varır; içerik kusuru insana gider.
6. **Çıkmaz durum yasağı.** Her durdurucu durumdan bir çıkış yolu olmalı; "insan bekliyor" diyen ekran düğmeyi de göstermeli.
7. **Arayüz yalan söylemez.** Ekran metni bugünkü davranışı anlatır; davranış değişince metin aynı işte güncellenir.

## Kullanım

- `.agents/rules/` — anayasa; sürekli aktif.
- `.agents/skills/` — persona el kitapları; ilgili persona sahneye çıkınca devreye girer.
- `tasks.json` — görev durum makinesi (`pending → in_progress → in_review → completed`), WIP = 1.

Lisans: kaynak depo MIT ile sunuluyor; kopyası `LICENSE-agent-squad` içinde.

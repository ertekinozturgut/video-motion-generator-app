import Link from "next/link";
import { getAdmin } from "@/lib/auth";
import { loadAdminSnapshot, assignedSteps } from "@/lib/admin/snapshot";
import { STEPS, STEP_ORDER } from "@/lib/providers/routing";
import { PROVIDER_LABEL, type ProviderKind } from "@/lib/providers/types";
import {
  Card, CardHeader, CheckRow, Chip, Dot, EmptyState, PageHeader, Stat, btn,
} from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Yönetim ekranının giriş sayfası tek bir soruya cevap verir:
 * "Gerçek bir çalışma başlatsam ne olur?"
 *
 * Bu yüzden sayfanın üstü sayaç değil, engel listesi. Sayaçlar altta;
 * hiçbir engel yoksa zaten okunacak bir şey kalmaz.
 */
export default async function AdminOverviewPage() {
  const admin = (await getAdmin())!; // layout zaten doğruladı
  const s = await loadAdminSnapshot(admin.userId);

  const active = s.providers.filter((p) => p.status === "active");
  const degraded = s.providers.filter((p) => p.status === "degraded");
  const assigned = assignedSteps(s.routes);
  const errors = s.issues.filter((i) => i.severity === "error");
  const warnings = s.issues.filter((i) => i.severity === "warning");

  const checks = [
    {
      ok: s.env.serviceRole,
      title: "Sunucu anahtarı tanımlı",
      detail: s.env.serviceRole
        ? "SUPABASE_SERVICE_ROLE_KEY okundu."
        : "SUPABASE_SERVICE_ROLE_KEY yok — job handler'ları veritabanına yazamaz.",
    },
    {
      ok: s.env.encryptionKey,
      title: "Şifreleme anahtarı tanımlı",
      detail: s.env.encryptionKey
        ? "PROVIDER_ENC_KEY_V1 okundu. Bu anahtar kaybolursa kayıtlı sağlayıcı anahtarları kalıcı olarak açılamaz."
        : "PROVIDER_ENC_KEY_V1 yok — sağlayıcı anahtarı kaydedilemez.",
    },
    {
      ok: s.env.cronSecret,
      title: "Cron gizli anahtarı tanımlı",
      detail: s.env.cronSecret
        ? "CRON_SECRET okundu; kuyruk tetikleyicileri korumalı."
        : "CRON_SECRET yok — worker tetiklemesi 401 döner, işler yalnız elle işlenir.",
    },
    {
      ok: active.length > 0,
      title: "Doğrulanmış sağlayıcı var",
      detail:
        active.length > 0
          ? `${active.length} sağlayıcı bağlantı sınamasından geçti.`
          : "Hiçbir sağlayıcı sınanmadı. Anahtarı kaydetmek yetmez, bağlantıyı da sına.",
      action: (
        <Link href="/settings/providers" className={btn.ghost}>
          Sağlayıcılar
        </Link>
      ),
    },
    {
      ok: s.families.length >= 2,
      title: "En az iki model ailesi",
      detail:
        s.families.length >= 2
          ? `Kullanılabilir aileler: ${s.families.join(", ")}.`
          : "Kontrol adımları üreten adımdan farklı aileden olmak zorunda. Tek aile ile plan kontrolü atanamaz.",
    },
    {
      ok: assigned.length === STEP_ORDER.length,
      title: "Yedi adımın hepsi atanmış",
      detail: `${assigned.length} / ${STEP_ORDER.length} adımda birincil model seçili.`,
      action: (
        <Link href="/settings/routing" className={btn.ghost}>
          Model dağıtımı
        </Link>
      ),
    },
    {
      ok: errors.length === 0,
      title: "Dağıtım doğrulaması temiz",
      detail:
        errors.length === 0
          ? warnings.length > 0
            ? `${warnings.length} uyarı var, engel yok.`
            : "Aile çeşitliliği, yetenek ve sıkıştırma kuralları sağlanıyor."
          : `${errors.length} engel var; bu haliyle kaydedilmiş dağıtım güvenli değil.`,
    },
  ];

  const blocking = checks.filter((c) => !c.ok);
  const queued = s.jobCounts.QUEUED ?? 0;
  const running = s.jobCounts.RUNNING ?? 0;
  const failed = s.jobCounts.FAILED ?? 0;
  const needsHuman = (s.runCounts.NEEDS_HUMAN ?? 0) + (s.runCounts.AWAITING_APPROVAL ?? 0);

  return (
    <>
      <PageHeader
        title="Genel bakış"
        lede="Sistemin gerçek bir çalışmayı yürütmeye hazır olup olmadığı. Sarı işaretli her satır, hazır olmayan bir şeyi gösterir."
      />

      <Card className="mb-8">
        <CardHeader
          title={blocking.length === 0 ? "Sistem hazır" : `${blocking.length} eksik var`}
          hint={
            blocking.length === 0
              ? "Tüm önkoşullar sağlandı. Çalışmalar bu dağıtımdaki modelleri kullanıyor."
              : "Aşağıdaki maddeler tamamlanmadan üretim çalıştırması beklendiği gibi ilerlemez."
          }
        />
        <ul className="divide-y divide-line">
          {checks.map((c) => (
            <CheckRow key={c.title} ok={c.ok} title={c.title} detail={c.detail} action={c.ok ? undefined : c.action} />
          ))}
        </ul>
      </Card>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Sağlayıcı" value={s.providers.length}
          sub={`${active.length} doğrulandı${degraded.length ? `, ${degraded.length} sorunlu` : ""}`}
          tone={degraded.length ? "bad" : active.length ? "good" : "attention"}
          href="/settings/providers"
        />
        <Stat
          label="Model" value={s.models.length}
          sub={s.families.length ? `${s.families.length} aile` : "aile yok"}
          tone={s.families.length >= 2 ? "good" : "attention"}
          href="/settings/providers"
        />
        <Stat
          label="Atanan adım" value={`${assigned.length}/${STEP_ORDER.length}`}
          sub={errors.length ? `${errors.length} engel` : warnings.length ? `${warnings.length} uyarı` : "doğrulama temiz"}
          tone={errors.length ? "bad" : assigned.length === STEP_ORDER.length ? "good" : "attention"}
          href="/settings/routing"
        />
        <Stat
          label="Kuyruk" value={queued + running}
          sub={failed ? `${failed} başarısız` : `${running} çalışıyor`}
          tone={failed ? "bad" : running ? "active" : "idle"}
          href="/settings/queue"
        />
      </div>

      {needsHuman > 0 && (
        <Card className="mb-8">
          <CardHeader
            title={`${needsHuman} çalışma seni bekliyor`}
            hint="Onay bekleyen veya müdahale isteyen çalışmalar duruyor; kendiliğinden ilerlemezler."
            action={<Link href="/" className={btn.ghost}>Çalışmalar</Link>}
          />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sağlayıcı durumu" action={<Link href="/settings/providers" className={btn.quiet}>Yönet</Link>} />
          {s.providers.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Henüz sağlayıcı yok."
                detail="Planlama ve kontrol adımlarının çalışması için en az iki farklı model ailesi gerekiyor."
                action={<Link href="/settings/providers" className={btn.primary}>Sağlayıcı ekle</Link>}
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {s.providers.map((p) => (
                <li key={p.provider_id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Dot tone={p.status === "active" ? "good" : p.status === "degraded" ? "bad" : "idle"} />
                    <span className="text-sm">{p.label}</span>
                    <span className="text-sm text-muted">
                      {PROVIDER_LABEL[p.kind as ProviderKind] ?? p.kind}
                    </span>
                    <span className="tnum ml-auto text-sm text-muted">
                      {p.last_latency_ms != null ? `${p.last_latency_ms} ms` : "sınanmadı"}
                    </span>
                  </div>
                  {p.last_error && <p className="mt-1 text-sm text-bad">{p.last_error}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Adım dağıtımı"
            hint="Kontrol adımları üreten adımdan farklı aileye bakmak zorunda."
            action={<Link href="/settings/routing" className={btn.quiet}>Düzenle</Link>}
          />
          <ul className="divide-y divide-line">
            {STEP_ORDER.map((step) => {
              const route = s.routes.find((r) => r.step === step);
              const model = s.models.find((m) => m.model_id === route?.primary_model_id);
              const stepErrors = errors.filter((i) => i.step === step);
              return (
                <li key={step} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                  <Dot tone={stepErrors.length ? "bad" : model ? "good" : "idle"} />
                  <span className="text-sm">{STEPS[step].label}</span>
                  <span className="ml-auto text-sm text-muted">
                    {model ? `${model.display_name} · ${model.family}` : "atanmadı"}
                  </span>
                  {STEPS[step].must_differ_from && <Chip tone="attention">judge</Chip>}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {errors.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Engeller" hint="Bunlar uyarı değil; dağıtımın bu haliyle kaydı reddedilir." />
          <ul className="divide-y divide-line">
            {errors.map((i, n) => (
              <li key={n} className="flex gap-3 px-5 py-3 text-sm">
                <span className="shrink-0 text-muted">{STEPS[i.step].label}</span>
                <span className="text-bad">{i.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

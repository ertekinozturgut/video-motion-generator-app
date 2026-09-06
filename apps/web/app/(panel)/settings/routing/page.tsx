import Link from "next/link";
import { getAdmin } from "@/lib/auth";
import { loadAdminSnapshot } from "@/lib/admin/snapshot";
import { EmptyState, PageHeader, btn } from "@/components/ui";
import { RoutingMatrix } from "./RoutingMatrix";

export const dynamic = "force-dynamic";

export default async function RoutingPage() {
  const admin = (await getAdmin())!; // layout doğruladı
  const s = await loadAdminSnapshot(admin.userId);

  return (
    <>
      <PageHeader
        title="Model dağıtımı"
        lede="Her adım kendi gereksinimini bildirir; uymayan modeller seçilemez. Kontrol adımları üreten adımdan farklı bir model ailesinde olmak zorunda — aksi halde sistem kendi çıktısını puanlar ve bu hiçbir metrikte görünmez."
      />

      {!s.presetId ? (
        <EmptyState
          title="Model profili bulunamadı."
          detail="0003_admin_and_seed.sql migration'ı uygulandı mı? Profil olmadan dağıtım kaydedilemez."
        />
      ) : s.models.length === 0 ? (
        <EmptyState
          title="Seçilebilecek model yok."
          detail="Önce sağlayıcı ekleyip modelleri getir. Kontrol adımlarının çalışması için en az iki farklı model ailesi gerekiyor."
          action={
            <Link href="/settings/providers" className={btn.primary}>
              Sağlayıcılara git
            </Link>
          }
        />
      ) : (
        <RoutingMatrix
          presetId={s.presetId}
          models={s.models}
          initial={s.routes}
          familyCount={s.families.length}
        />
      )}
    </>
  );
}

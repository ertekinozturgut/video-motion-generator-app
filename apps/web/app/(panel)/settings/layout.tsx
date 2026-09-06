import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/auth";
import { isConfigured } from "@/lib/supabase/env";
import { Setup } from "@/components/Setup";
import { SettingsNav } from "./SettingsNav";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { serviceRoleProblem } from "@/lib/supabase/admin";

/**
 * Yönetim alanının tek kapısı. Rol kontrolü burada bir kez yapılır;
 * alt sayfalar admin olduğunu varsayabilir. Kontrolü her sayfaya
 * dağıtmak, bir gün birini unutmak demek.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  if (!isConfigured()) return <Setup />;
  const admin = await getAdmin();
  if (!admin) redirect("/");

  const problem = serviceRoleProblem();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-10 lg:flex-row lg:gap-12">
      <aside className="lg:w-56 lg:shrink-0">
        <div className="mb-4 text-xs uppercase tracking-wide text-muted">Yönetim</div>
        <SettingsNav />
        <p className="mt-6 hidden text-xs leading-relaxed text-muted lg:block">
          Bu bölüm yalnız admin rolüne açık. Anahtarlar şifreli saklanır,
          panel yalnız son dört haneyi görür.
        </p>
      </aside>

      <div className="min-w-0 flex-1">
        {problem ? <ServiceRoleBroken problem={problem} /> : children}
      </div>
    </div>
  );
}

/**
 * Yönetim ekranları service role istemcisine bağlı. Anahtar yoksa sayfa
 * 500 vermek yerine eksiğin ne olduğunu söylemeli — "hazır mıyım" sorusunu
 * cevaplayan bölümün kendisi çökemez.
 */
function ServiceRoleBroken({ problem }: { problem: string }) {
  return (
    <>
      <PageHeader
        title="Yönetim kapalı"
        lede="Bu bölüm sağlayıcı anahtarlarını ve kuyruğu okumak için service role istemcisini kullanır."
      />
      <Card>
        <CardHeader title={`SUPABASE_SERVICE_ROLE_KEY ${problem}`} />
        <div className="space-y-3 px-5 py-4 text-sm leading-relaxed text-muted">
          <p>
            Doğru değer Supabase → Settings → API Keys ekranındaki{" "}
            <span className="tnum text-text">service_role</span> / secret anahtarı.
            <span className="tnum"> sb_publishable_</span> ile başlayan anahtar
            tarayıcı anahtarıdır, buraya girilmez.
          </p>
          <p>
            Yanlış anahtar sessiz bir arızaya yol açıyor: okumalar RLS altında boş
            sonuç dönüp başarılı görünüyor, ilk kayıt denemesi ise{" "}
            <span className="tnum">new row violates row-level security policy</span>{" "}
            ile patlıyor ve hata anahtarı değil politikayı işaret ediyor.
          </p>
          <p>
            Değeri Vercel → Settings → Environment Variables altında düzeltip yeniden
            dağıt; yerelde apps/web/.env.local dosyasına yaz. Bu anahtar RLS&apos;i
            bypass eder, asla NEXT_PUBLIC olmaz.
          </p>
        </div>
      </Card>
    </>
  );
}

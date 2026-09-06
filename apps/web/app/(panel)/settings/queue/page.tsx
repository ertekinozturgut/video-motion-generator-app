import { getAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui";
import { QueueBoard, type QueueJob } from "./QueueBoard";

export const dynamic = "force-dynamic";

const STATUSES = ["QUEUED", "RUNNING", "FAILED", "DONE", "CANCELLED"] as const;

export default async function QueuePage() {
  const admin = (await getAdmin())!;
  const db = createAdminClient();

  const [{ data: jobs }, { data: all }] = await Promise.all([
    db.from("jobs")
      .select("job_id,job_type,status,attempt,max_attempts,scheduled_for,lease_until,last_error,run_id,created_at,updated_at")
      .eq("owner_id", admin.userId)
      .order("created_at", { ascending: false })
      .limit(80),
    db.from("jobs").select("status").eq("owner_id", admin.userId),
  ]);

  const counts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of (all ?? []) as Array<{ status: string }>) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  return (
    <>
      <PageHeader
        title="Kuyruk"
        lede="İşler kalıcı; dispatch kaçarsa cron toparlar. Buradaki müdahale son çare — bir işi tekrar denemek, kalıcı bir hatayı çözmez, yalnız erteler."
      />
      <QueueBoard
        counts={counts}
        jobs={((jobs ?? []) as unknown as QueueJob[])}
      />
    </>
  );
}

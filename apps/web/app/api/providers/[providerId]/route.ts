import { NextResponse, type NextRequest } from "next/server";
import { getAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });

  const { providerId } = await params;
  const db = createAdminClient();

  const { error } = await db
    .from("providers")
    .delete()
    .eq("provider_id", providerId)
    .eq("owner_id", admin.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}

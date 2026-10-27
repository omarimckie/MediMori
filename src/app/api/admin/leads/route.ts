import { isAdminAuthenticated } from "@/lib/admin-auth";
import { leadsToCsv, readStoredLeads } from "@/lib/leads-store";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const leads = await readStoredLeads();
  const sorted = [...leads].sort(
    (a, b) => Date.parse(b.signedUpAt) - Date.parse(a.signedUpAt),
  );

  const format = new URL(request.url).searchParams.get("format");
  if (format === "csv") {
    return new NextResponse(leadsToCsv(sorted), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="twilight-feather-email-list.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    leads: sorted,
    count: sorted.length,
  });
}

import { NextResponse } from "next/server";
import { getAdminReports } from "@/lib/admin-data";
import { accessDenied, requireApiAdmin } from "@/lib/route-guards";
import { AuthError } from "@/lib/route-guards";
import { rateLimitApi } from "@/lib/security";

function csvCell(value: string | number) {
  const text = String(value).replaceAll('"', '""');
  return `"${text}"`;
}

export async function GET(request: Request) {
  const limited = rateLimitApi(request, "report-export", { limit: 10, windowMs: 60 * 60_000 });
  if (limited) return limited;
  try {
    await requireApiAdmin();
    const report = await getAdminReports();
    const rows = [
      ["Metric", "Value"],
      ["Bookings", report.totals.bookings],
      ["Booked value", report.totals.revenue],
      ["Collected", report.totals.collected],
      ["Outstanding", report.totals.outstanding],
      [],
      ["Event type", "Bookings", "Revenue"],
      ...report.byType.map((item) => [item.eventType, item.count, item.revenue]),
      [],
      ["Status", "Bookings"],
      ...report.byStatus.map((item) => [item.status, item.count]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=event-management-report.csv",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return accessDenied(error, "Unable to export the report right now.");
    return NextResponse.json({ error: "Unable to export the report right now." }, { status: 400 });
  }
}

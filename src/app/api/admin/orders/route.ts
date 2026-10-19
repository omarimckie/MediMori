import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  filterAdminOrderList,
  listAdminOrdersForDashboard,
  parseAdminOrderListFilters,
} from "@/lib/order-notifications/admin-orders-list";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const filters = parseAdminOrderListFilters(new URL(request.url).searchParams);
  const rows = await listAdminOrdersForDashboard();
  const orders = filterAdminOrderList(rows, filters);

  return NextResponse.json({
    orders,
    count: orders.length,
    filters,
  });
}

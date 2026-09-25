import { getMarketingStore } from "@/lib/marketing/context";
import { resolveFreeResourceDownload } from "@/lib/marketing/resource-download";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await resolveFreeResourceDownload(getMarketingStore(), id);
  if (result.kind === "not_found") {
    return NextResponse.json({ error: "Resource not found." }, { status: 404 });
  }
  if (result.kind === "local_file") {
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Content-Disposition": `attachment; filename="${result.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  return NextResponse.redirect(result.url, { status: 302 });
}

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getStaticSeedPosts } from "@/lib/blog";
import { mergeSeedPosts } from "@/lib/blog-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const added = await mergeSeedPosts(getStaticSeedPosts());
  return NextResponse.json({ added });
}

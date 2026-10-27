import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  previewDbIdentityResponse,
  queryPreviewDatabaseIdentity,
} from "@/lib/marketing/preview-db-identity";
import { isMarketingPreviewReadonly } from "@/lib/marketing/preview-readonly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return previewDbIdentityResponse({
    isAuthenticated: isAdminAuthenticated,
    isPreviewReadonly: () => isMarketingPreviewReadonly(),
    queryIdentity: () => queryPreviewDatabaseIdentity(),
  });
}

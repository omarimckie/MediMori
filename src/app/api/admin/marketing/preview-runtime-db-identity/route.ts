import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  isPreviewRuntimeDbIdentityEnvironment,
  previewRuntimeDbIdentityResponse,
  queryPreviewRuntimeDatabaseIdentity,
} from "@/lib/marketing/preview-runtime-db-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return previewRuntimeDbIdentityResponse({
    isAuthenticated: isAdminAuthenticated,
    isPreviewRuntime: () => isPreviewRuntimeDbIdentityEnvironment(),
    queryIdentity: () => queryPreviewRuntimeDatabaseIdentity(),
  });
}
import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  isProductionDbIdentityEnvironment,
  productionDbIdentityResponse,
  queryProductionDatabaseIdentity,
} from "@/lib/marketing/production-db-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return productionDbIdentityResponse({
    isAuthenticated: isAdminAuthenticated,
    isProductionEnvironment: () => isProductionDbIdentityEnvironment(),
    queryIdentity: () => queryProductionDatabaseIdentity(),
  });
}
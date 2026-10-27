/**
 * READ-ONLY newsletter migration preflight.
 * Does not create/update Stripe objects, DB rows, or Blob leads.
 */
import { formatMigrationPreflightReport } from "../src/lib/newsletter-migration-preflight";
import { executeNewsletterMigrationPreflight } from "../src/lib/newsletter-migration-preflight-run";

async function main(): Promise<void> {
  const report = await executeNewsletterMigrationPreflight();
  console.log(formatMigrationPreflightReport(report));
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "newsletter migration dry-run failed",
  );
  process.exit(1);
});

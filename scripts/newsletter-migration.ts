/**
 * Newsletter promotion cutover CLI.
 * Default: read-only validation + dry-run plan (no writes).
 * Writes require explicit --apply.
 */
import {
  formatNewsletterMigrationCutoverReport,
  formatNewsletterMigrationRollbackProcedure,
} from "../src/lib/newsletter-migration-cutover";
import { executeNewsletterMigrationCutover } from "../src/lib/newsletter-migration-cutover-run";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--rollback-help")) {
    console.log(formatNewsletterMigrationRollbackProcedure());
    return;
  }

  const apply = args.includes("--apply");
  if (args.some((arg) => arg.startsWith("-") && arg !== "--apply")) {
    console.error("Unknown flag. Use --apply for writes or --rollback-help for rollback steps.");
    process.exit(1);
  }

  const report = await executeNewsletterMigrationCutover({ apply });
  console.log(formatNewsletterMigrationCutoverReport(report));

  if (report.aborted) {
    process.exit(1);
  }
  if (report.postCutoverVerification && !report.postCutoverVerification.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "newsletter migration failed",
  );
  process.exit(1);
});

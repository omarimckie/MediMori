import assert from "node:assert/strict";
import cp from "node:child_process";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  assertIntegrationExecuteAuthorization,
  assertLinuxAmd64Platform,
  assertOfficialImageRepository,
  assertPostgresMajorVersion16,
  assertRunnerNode22AlpineFamily,
  fetchLocalImageInspectRecord,
  imageInspectMatchesPinnedDigest,
  PHASES_BEFORE_DISPOSABLE_SQL,
  PREFLIGHT_PHASES_BEFORE_DOCKER_MUTATION,
  pinnedDigestFromReference,
  validateImageInspectForPinnedReference,
} from "./dispatcher-watchdog-integration-image-preflight.mjs";
import {
  APPROVED_INTEGRATION_POSTGRES_IMAGE_REF,
  APPROVED_INTEGRATION_RUNNER_IMAGE_REF,
  assertLinuxRunnerStagingReadiness,
  assertPinnedImageReference,
  EXPECTED_REPO_ROOT,
} from "./dispatcher-watchdog-integration-wrapper-lib.mjs";
import { resolveMarketingDispatcherWatchdogTestDatabaseUrl } from "./resolve-marketing-dispatcher-watchdog-test-database-url.mjs";
import {
  assertDockerRunUsesPullNever,
  buildPostgresDisposableRunArgv,
  buildRunnerDisposableRunArgv,
} from "./dispatcher-watchdog-integration-docker-run.mjs";

const POSTGRES_PIN = APPROVED_INTEGRATION_POSTGRES_IMAGE_REF;
const RUNNER_PIN = APPROVED_INTEGRATION_RUNNER_IMAGE_REF;
const POSTGRES_DIGEST = pinnedDigestFromReference(POSTGRES_PIN);
const RUNNER_DIGEST = pinnedDigestFromReference(RUNNER_PIN);
const LEGACY_POSTGRES_COMPOUND =
  "postgres:16@sha256:75adc2a65806c96bc0e59030230bfe3f1c1b0d6d8f8181a8913e2b8b53bdc166";
const LEGACY_RUNNER_COMPOUND =
  "node:22@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402";

function postgresFixture(overrides = {}) {
  return {
    Id: POSTGRES_DIGEST,
    Os: "linux",
    Architecture: "amd64",
    RepoDigests: [`postgres@${POSTGRES_DIGEST}`],
    Identity: { Pull: [{ Repository: "docker.io/library/postgres" }] },
    Descriptor: { digest: POSTGRES_DIGEST },
    Config: {
      Env: ["PG_MAJOR=16", "PG_VERSION=16.15-1.pgdg13+2", "PATH=/usr/lib/postgresql/16/bin"],
    },
    ...overrides,
  };
}

function runnerFixture(overrides = {}) {
  return {
    Id: RUNNER_DIGEST,
    Os: "linux",
    Architecture: "amd64",
    RepoDigests: [`node@${RUNNER_DIGEST}`],
    Identity: { Pull: [{ Repository: "docker.io/library/node" }] },
    Descriptor: {
      digest: RUNNER_DIGEST,
      annotations: { "org.opencontainers.image.base.name": "alpine:3.24" },
    },
    Config: {
      Env: ["NODE_VERSION=22.14.0", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
    },
    ...overrides,
  };
}

describe("strict pinned image reference correction (T1–T24)", () => {
  it("T1 approved PostgreSQL repo@digest reference accepted", () => {
    assert.equal(assertPinnedImageReference(POSTGRES_PIN, "postgres"), POSTGRES_PIN);
    validateImageInspectForPinnedReference(postgresFixture(), POSTGRES_PIN, "postgres");
  });

  it("T2 approved Node repo@digest reference accepted", () => {
    assert.equal(assertPinnedImageReference(RUNNER_PIN, "runner"), RUNNER_PIN);
    validateImageInspectForPinnedReference(runnerFixture(), RUNNER_PIN, "runner");
  });

  it("T3 previous compound postgres:16@digest reference rejected", () => {
    assert.throws(
      () => assertPinnedImageReference(LEGACY_POSTGRES_COMPOUND, "postgres"),
      /integration_image_compound_reference_rejected:postgres/,
    );
  });

  it("T4 previous compound node:22@digest reference rejected", () => {
    assert.throws(
      () => assertPinnedImageReference(LEGACY_RUNNER_COMPOUND, "runner"),
      /integration_image_compound_reference_rejected:runner/,
    );
  });

  it("T5 mutable postgres:16 tag rejected", () => {
    assert.throws(
      () => assertPinnedImageReference("postgres:16", "postgres"),
      /integration_image_digest_missing/,
    );
  });

  it("T6 mutable node:22 tag rejected", () => {
    assert.throws(
      () => assertPinnedImageReference("node:22", "runner"),
      /integration_image_digest_missing/,
    );
  });

  it("T7 incorrect PostgreSQL digest rejected", () => {
    const wrongPin =
      "postgres@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    assert.throws(
      () => validateImageInspectForPinnedReference(postgresFixture(), wrongPin, "postgres"),
      /integration_image_digest_mismatch:postgres/,
    );
  });

  it("T8 incorrect Node digest rejected", () => {
    const wrongPin =
      "node@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    assert.throws(
      () => validateImageInspectForPinnedReference(runnerFixture(), wrongPin, "runner"),
      /integration_image_digest_mismatch:runner/,
    );
  });

  it("T9 correct reference with incorrect image ID rejected", () => {
    assert.throws(
      () =>
        validateImageInspectForPinnedReference(
          postgresFixture({
            Id: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            RepoDigests: [],
            Descriptor: {},
          }),
          POSTGRES_PIN,
          "postgres",
        ),
      /integration_image_digest_mismatch:postgres/,
    );
  });

  it("T10 correct image ID with missing required RepoDigest rejected", () => {
    assert.throws(
      () =>
        validateImageInspectForPinnedReference(
          postgresFixture({ RepoDigests: [] }),
          POSTGRES_PIN,
          "postgres",
        ),
      /integration_image_repo_digest_mismatch:postgres/,
    );
  });

  it("T11 correct image ID with mismatched RepoDigest rejected", () => {
    assert.throws(
      () =>
        validateImageInspectForPinnedReference(
          postgresFixture({
            RepoDigests: [
              "postgres@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            ],
          }),
          POSTGRES_PIN,
          "postgres",
        ),
      /integration_image_repo_digest_mismatch:postgres/,
    );
  });

  it("T12 non-linux image rejected", () => {
    assert.throws(() => assertLinuxAmd64Platform({ Os: "windows", Architecture: "amd64" }), /os_not_linux/);
  });

  it("T13 non-amd64 image rejected", () => {
    assert.throws(() => assertLinuxAmd64Platform({ Os: "linux", Architecture: "arm64" }), /arch_not_amd64/);
  });

  it("T14 PostgreSQL wrong major version rejected", () => {
    assert.throws(
      () => assertPostgresMajorVersion16({ Config: { Env: ["PG_MAJOR=18"] } }),
      /integration_postgres_major_not_16/,
    );
  });

  it("T15 Node wrong major version rejected", () => {
    assert.throws(
      () =>
        assertRunnerNode22AlpineFamily({
          Config: { Env: ["NODE_VERSION=21.0.0"] },
        }),
      /integration_runner_node_version_not_22/,
    );
  });

  it("T16 missing image fails closed", () => {
    const restore = mock.method(cp, "execFileSync", () => {
      throw Object.assign(new Error("No such image"), { status: 1 });
    });
    try {
      assert.throws(() => fetchLocalImageInspectRecord(POSTGRES_PIN), /integration_image_not_local/);
    } finally {
      restore.mock.restore();
    }
  });

  it("T17 preflight uses the same reference intended for Docker execution", () => {
    const pgArgv = buildPostgresDisposableRunArgv({
      imageRef: POSTGRES_PIN,
      containerName: "tf-watchdog-pg-run1",
      networkName: "tf-watchdog-net-run1",
      volumeName: "tf-watchdog-vol-run1",
      pgUser: "u",
      pgPassword: "p",
      pgDatabase: "db",
    });
    const runnerArgv = buildRunnerDisposableRunArgv({
      imageRef: RUNNER_PIN,
      containerName: "tf-watchdog-runner-run1",
      networkName: "tf-watchdog-net-run1",
      workspaceHostPath: "/tmp/workspace",
      integrationEnv: {
        MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: "disposable-local-only",
        MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: "postgresql://u:p@tf-watchdog-pg-run1:5432/db",
        MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: "tf-watchdog-pg-run1",
        MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID: "run1",
      },
    });
    assert.equal(pgArgv.at(-1), POSTGRES_PIN);
    assert.ok(runnerArgv.includes(RUNNER_PIN));
    assert.equal(runnerArgv[runnerArgv.indexOf(RUNNER_PIN) + 1], "sleep");
    assertPinnedImageReference(pgArgv.at(-1), "postgres");
    assertPinnedImageReference(RUNNER_PIN, "runner");
  });

  it("T18 --pull=never remains required", () => {
    const argv = buildPostgresDisposableRunArgv({
      imageRef: POSTGRES_PIN,
      containerName: "c",
      networkName: "n",
      volumeName: "v",
      pgUser: "u",
      pgPassword: "p",
      pgDatabase: "db",
    });
    assertDockerRunUsesPullNever(argv);
    assert.equal(argv[2], "--pull=never");
  });

  it("T19 no mutable-tag fallback is introduced", () => {
    const argv = buildPostgresDisposableRunArgv({
      imageRef: POSTGRES_PIN,
      containerName: "c",
      networkName: "n",
      volumeName: "v",
      pgUser: "u",
      pgPassword: "p",
      pgDatabase: "db",
    });
    assert.equal(argv.filter((part) => part === "postgres:16" || part === "node:22").length, 0);
    assert.throws(() => assertPinnedImageReference("postgres:16", "postgres"), /digest_missing/);
  });

  it("T20 existing approved image IDs and digest values remain unchanged", () => {
    assert.equal(
      POSTGRES_DIGEST,
      "sha256:75adc2a65806c96bc0e59030230bfe3f1c1b0d6d8f8181a8913e2b8b53bdc166",
    );
    assert.equal(
      RUNNER_DIGEST,
      "sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402",
    );
    assert.equal(APPROVED_INTEGRATION_POSTGRES_IMAGE_REF, `postgres@${POSTGRES_DIGEST}`);
    assert.equal(APPROVED_INTEGRATION_RUNNER_IMAGE_REF, `node@${RUNNER_DIGEST}`);
  });

  it("T21 Docker inspect errors are handled without weakening validation", () => {
    const restore = mock.method(cp, "execFileSync", () => {
      throw Object.assign(new Error("error: no such object"), { status: 1 });
    });
    try {
      assert.throws(() => fetchLocalImageInspectRecord(RUNNER_PIN), /integration_image_not_local/);
    } finally {
      restore.mock.restore();
    }
  });

  it("T22 no Docker command is executed by offline tests", () => {
    const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
    assert.doesNotMatch(self, /docker\s+image\s+inspect/);
    assert.doesNotMatch(self, /execFileSync\(\s*["']docker["']/);
  });

  it("T23 pg remains a development-only dependency for disposable integration", () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    );
    assert.ok(manifest.devDependencies?.pg);
    assert.ok(manifest.devDependencies?.["@types/pg"]);
    assert.equal(manifest.dependencies?.pg, undefined);
  });

  it("T24 production database and watchdog modules remain unchanged", () => {
    const repo = readFileSync(
      fileURLToPath(
        new URL(
          "../src/lib/marketing/reliability/dispatcher-watchdog/repository.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    assert.doesNotMatch(repo, /APPROVED_INTEGRATION_POSTGRES_IMAGE_REF/);
    assert.doesNotMatch(repo, /postgres@sha256:/);
  });
});

describe("integration image preflight", () => {
  it("accepts correct pinned PostgreSQL image inspect", () => {
    validateImageInspectForPinnedReference(postgresFixture(), POSTGRES_PIN, "postgres");
  });

  it("accepts correct pinned Node runner image inspect", () => {
    validateImageInspectForPinnedReference(runnerFixture(), RUNNER_PIN, "runner");
  });

  it("rejects missing local image via digest mismatch surrogate", () => {
    assert.throws(
      () =>
        validateImageInspectForPinnedReference(
          postgresFixture({
            Id: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            RepoDigests: [],
            Descriptor: {},
          }),
          POSTGRES_PIN,
          "postgres",
        ),
      /integration_image_digest_mismatch:postgres/,
    );
  });

  it("rejects wrong PostgreSQL digest", () => {
    const wrongPin =
      "postgres@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    assert.throws(
      () => validateImageInspectForPinnedReference(postgresFixture(), wrongPin, "postgres"),
      /integration_image_digest_mismatch:postgres/,
    );
  });

  it("rejects wrong Node digest", () => {
    const wrongPin =
      "node@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    assert.throws(
      () => validateImageInspectForPinnedReference(runnerFixture(), wrongPin, "runner"),
      /integration_image_digest_mismatch:runner/,
    );
  });

  it("rejects mutable tag without digest", () => {
    assert.throws(
      () => assertPinnedImageReference("postgres:16", "postgres"),
      /integration_image_digest_missing/,
    );
  });

  it("rejects wrong OS", () => {
    assert.throws(() => assertLinuxAmd64Platform({ Os: "windows", Architecture: "amd64" }), /os_not_linux/);
  });

  it("rejects wrong architecture", () => {
    assert.throws(() => assertLinuxAmd64Platform({ Os: "linux", Architecture: "arm64" }), /arch_not_amd64/);
  });

  it("rejects wrong PostgreSQL major", () => {
    assert.throws(
      () => assertPostgresMajorVersion16({ Config: { Env: ["PG_MAJOR=18"] } }),
      /integration_postgres_major_not_16/,
    );
  });

  it("rejects wrong Node image family", () => {
    assert.throws(
      () =>
        assertRunnerNode22AlpineFamily({
          Config: { Env: ["NODE_VERSION=22.0.0", "PG_MAJOR=16"] },
        }),
      /integration_runner_image_family_invalid/,
    );
  });

  it("distinguishes image ID from mismatched manifest digest field", () => {
    const inspect = postgresFixture({
      Descriptor: { digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
    });
    assert.equal(imageInspectMatchesPinnedDigest(inspect, POSTGRES_DIGEST), true);
    validateImageInspectForPinnedReference(inspect, POSTGRES_PIN, "postgres");
    assert.equal(
      imageInspectMatchesPinnedDigest(
        inspect,
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      ),
      false,
    );
  });

  it("includes --pull=never on PostgreSQL docker run argv", () => {
    const argv = buildPostgresDisposableRunArgv({
      imageRef: POSTGRES_PIN,
      containerName: "tf-watchdog-pg-run1",
      networkName: "tf-watchdog-net-run1",
      volumeName: "tf-watchdog-vol-run1",
      pgUser: "u",
      pgPassword: "p",
      pgDatabase: "db",
    });
    assertDockerRunUsesPullNever(argv);
    assert.equal(argv[2], "--pull=never");
  });

  it("includes --pull=never on Node runner docker run argv", () => {
    const argv = buildRunnerDisposableRunArgv({
      imageRef: RUNNER_PIN,
      containerName: "tf-watchdog-runner-run1",
      networkName: "tf-watchdog-net-run1",
      workspaceHostPath: "/tmp/workspace",
      integrationEnv: {
        MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: "disposable-local-only",
        MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: "postgresql://u:p@tf-watchdog-pg-run1:5432/db",
        MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: "tf-watchdog-pg-run1",
        MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID: "run1",
      },
    });
    assertDockerRunUsesPullNever(argv);
    assert.equal(argv[2], "--pull=never");
  });

  it("does not add automatic image fallback in argv builders", () => {
    const argv = buildPostgresDisposableRunArgv({
      imageRef: POSTGRES_PIN,
      containerName: "c",
      networkName: "n",
      volumeName: "v",
      pgUser: "u",
      pgPassword: "p",
      pgDatabase: "db",
    });
    assert.equal(argv.filter((part) => part.includes("postgres:18")).length, 0);
    assert.equal(argv.at(-1), POSTGRES_PIN);
  });

  it("rejects missing execute authorization", () => {
    assert.throws(() => assertIntegrationExecuteAuthorization({}), /integration_execute_authorization_required/);
  });

  it("has no production database fallback in resolver", () => {
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl({
          MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: "disposable-local-only",
          MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: "postgresql://u:p@ep-muddy-math.neon.tech/db",
          MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: "tf-watchdog-pg-run1",
          MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID: "run1",
        }),
      /host_forbidden/,
    );
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl({
          MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: "disposable-local-only",
          MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: "postgresql://u:p@tf-watchdog-pg-run1:5432/db",
          MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: "tf-watchdog-pg-wrong",
          MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID: "run1",
        }),
      /expected_pg_host_mismatch/,
    );
    assert.throws(
      () =>
        resolveMarketingDispatcherWatchdogTestDatabaseUrl({
          MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW: "disposable-local-only",
          MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL: "postgresql://u:p@tf-watchdog-pg-run1:5432/db",
          MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST: "tf-watchdog-pg-run1",
        }),
      /run_id_missing/,
    );
  });

  it("orders isolation phases before disposable SQL", () => {
    assert.ok(PREFLIGHT_PHASES_BEFORE_DOCKER_MUTATION.includes("local_pinned_images"));
    assert.ok(PHASES_BEFORE_DISPOSABLE_SQL.includes("postgres_isolation_validate"));
    assert.ok(PHASES_BEFORE_DISPOSABLE_SQL.includes("runner_isolation_validate"));
    assert.equal(PHASES_BEFORE_DISPOSABLE_SQL.includes("disposable_schema_apply"), false);
    const pgIso = PHASES_BEFORE_DISPOSABLE_SQL.indexOf("postgres_isolation_validate");
    const runnerIso = PHASES_BEFORE_DISPOSABLE_SQL.indexOf("runner_isolation_validate");
    assert.ok(pgIso >= 0 && runnerIso > pgIso);
  });

  it("rejects missing esbuild staging root", () => {
    assert.throws(
      () => assertLinuxRunnerStagingReadiness(EXPECTED_REPO_ROOT, {}),
      /esbuild_staging_root_missing|linux_runner_staging_closure_failed|linux_runner_native_missing/,
    );
  });

  it("rejects unofficial repository identity", () => {
    assert.throws(
      () => assertOfficialImageRepository({ RepoDigests: ["evil@sha256:abc"] }, "postgres"),
      /integration_image_repo_not_official:postgres/,
    );
  });
});

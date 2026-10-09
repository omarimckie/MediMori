/** Trusted validation-runner recipe; it is not provider-controlled source. */
export const VALIDATION_OVERLAY_POLICY_VERSION = 1;

/** Setup performed by the owned volume-population container, before validation. */
export function initializeNextEnvPrivateOverlayCommand(expectedSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("Invalid trusted overlay hash.");
  return `set -eu; test -f /workspace/next-env.d.ts; test ! -L /workspace/next-env.d.ts; node -e 'const f=require("node:fs"),c=require("node:crypto"),h=p=>c.createHash("sha256").update(f.readFileSync(p)).digest("hex");if(h("/workspace/next-env.d.ts")!=="${expectedSha256}")process.exit(1)'; mkdir -p /workspace/.next /workspace/node_modules /workspace/private /workspace/public/marketing-uploads; chown -R 1000:1000 /workspace /cache /uploads /private; rm -f /workspace/tsconfig.tsbuildinfo; ln -s /tmp/engineering-tsconfig.tsbuildinfo /workspace/tsconfig.tsbuildinfo; cp /workspace/next-env.d.ts /private/engineering-next-env.d.ts; node -e 'const f=require("node:fs"),c=require("node:crypto"),h=p=>c.createHash("sha256").update(f.readFileSync(p)).digest("hex");if(h("/private/engineering-next-env.d.ts")!=="${expectedSha256}")process.exit(1)'; chown 1000:1000 /private/engineering-next-env.d.ts; rm /workspace/next-env.d.ts; ln -s private/engineering-next-env.d.ts /workspace/next-env.d.ts`;
}

export type ValidationVolumeNames = {
  source: string;
  cache: string;
  uploads: string;
  private: string;
  dependencies: string;
};

/** The validation container sees immutable source/dependencies and only owned runtime volumes writable. */
export function validationVolumeMountArgs(volumes: ValidationVolumeNames): string[] {
  return [
    "--mount", `type=volume,source=${volumes.source},target=/workspace,readonly`,
    "--mount", `type=volume,source=${volumes.cache},target=/workspace/.next`,
    "--mount", `type=volume,source=${volumes.uploads},target=/workspace/public/marketing-uploads`,
    "--mount", `type=volume,source=${volumes.private},target=/workspace/private`,
    "--mount", `type=volume,source=${volumes.dependencies},target=/workspace/node_modules,readonly`,
  ];
}

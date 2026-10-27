import { request as httpsRequest } from "node:https";

export type PinnedHttpsGetResult =
  | { ok: true; status: number; body: string }
  | { ok: false; reason: string };

export function pinnedHttpsGetText(input: {
  url: URL;
  pinnedAddresses: string[];
  headers?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<PinnedHttpsGetResult> {
  const { url, pinnedAddresses, headers = {}, timeoutMs, signal } = input;
  if (!pinnedAddresses.length) {
    return Promise.resolve({ ok: false, reason: "No pinned destination addresses." });
  }

  let lastError = "Status endpoint could not be reached safely.";

  const attempt = (address: string): Promise<PinnedHttpsGetResult> =>
    new Promise((resolve) => {
      const req = httpsRequest(
        {
          host: address,
          port: 443,
          servername: url.hostname,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers: {
            ...headers,
            host: url.hostname,
          },
          rejectUnauthorized: true,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => {
            chunks.push(chunk as Buffer);
          });
          res.on("end", () => {
            resolve({
              ok: true,
              status,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
          res.on("error", () => {
            resolve({ ok: false, reason: lastError });
          });
        },
      );

      req.on("error", () => {
        resolve({ ok: false, reason: lastError });
      });

      const timer = setTimeout(() => {
        req.destroy();
        resolve({ ok: false, reason: "Status endpoint timed out." });
      }, timeoutMs);

      const onAbort = () => {
        req.destroy();
        resolve({ ok: false, reason: "Status endpoint timed out." });
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      req.on("close", () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      });

      req.end();
    });

  return pinnedAddresses.reduce<Promise<PinnedHttpsGetResult>>(
    async (previous, address) => {
      const prior = await previous;
      if (prior.ok) return prior;
      lastError = prior.reason;
      return attempt(address);
    },
    Promise.resolve({ ok: false, reason: lastError }),
  );
}

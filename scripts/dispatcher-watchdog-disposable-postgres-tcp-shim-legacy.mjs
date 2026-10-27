/**
 * Historical Neon WebSocket-over-TCP shim for disposable Postgres (retired from active path).
 * Retained for offline regression of the prior transport attempt.
 */
import net from "node:net";
import { Pool, neonConfig } from "@neondatabase/serverless";

export const DISPOSABLE_WATCHDOG_PG_DRIVER_ID = "neon-serverless-tcp-websocket-shim";

let disposableTcpShimConfigured = false;

/**
 * @param {string} wsUrl
 * @returns {{ host: string, port: number }}
 */
export function parseDisposablePostgresWsTarget(wsUrl) {
  const url = new URL(wsUrl);
  const address = url.searchParams.get("address");
  if (address) {
    const lastColon = address.lastIndexOf(":");
    if (lastColon <= 0) {
      throw new Error("disposable_pg_tcp_address_invalid");
    }
    const host = address.slice(0, lastColon);
    const port = Number(address.slice(lastColon + 1));
    if (!host || !Number.isFinite(port) || port <= 0) {
      throw new Error("disposable_pg_tcp_address_invalid");
    }
    return { host, port };
  }
  const port = url.port ? Number(url.port) : 5432;
  if (!url.hostname || !Number.isFinite(port)) {
    throw new Error("disposable_pg_tcp_address_invalid");
  }
  return { host: url.hostname, port };
}

export class DisposablePostgresTcpWebSocket {
  constructor(wsUrl) {
    this.binaryType = "arraybuffer";
    /** @type {Record<string, Function[]>} */
    this._handlers = { open: [], message: [], error: [], close: [] };
    const { host, port } = parseDisposablePostgresWsTarget(wsUrl);
    this._socket = net.createConnection({ host, port });
    this._socket.on("connect", () => this._dispatch("open"));
    this._socket.on("data", (chunk) => {
      const arrayBuffer = chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength,
      );
      this._dispatch("message", { data: arrayBuffer });
    });
    this._socket.on("error", (err) => this._dispatch("error", err));
    this._socket.on("close", () => this._dispatch("close"));
  }

  addEventListener(type, handler) {
    if (!this._handlers[type]) {
      this._handlers[type] = [];
    }
    this._handlers[type].push(handler);
    if (
      type === "open" &&
      this._socket &&
      !this._socket.connecting &&
      !this._socket.destroyed
    ) {
      queueMicrotask(() => handler());
    }
  }

  send(data) {
    const buf =
      data instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(data))
        : Buffer.from(data);
    this._socket.write(buf);
  }

  close() {
    this._socket.end();
  }

  _dispatch(type, payload) {
    for (const handler of this._handlers[type] ?? []) {
      handler(payload);
    }
  }
}

export function configureDisposableNeonTcpTransport() {
  if (disposableTcpShimConfigured) {
    return;
  }
  disposableTcpShimConfigured = true;
  neonConfig.useSecureWebSocket = false;
  neonConfig.forceDisablePgSSL = true;
  neonConfig.pipelineConnect = "password";
  neonConfig.webSocketConstructor = DisposablePostgresTcpWebSocket;
}

/**
 * @param {string} connectionString resolved disposable URL (caller must not log)
 * @returns {import('@neondatabase/serverless').Pool}
 */
export function createDisposableWatchdogPgPool(connectionString) {
  configureDisposableNeonTcpTransport();
  return new Pool({ connectionString });
}

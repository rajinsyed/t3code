// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Drives the real server binary over real sockets.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { ORCHESTRATION_PROTOCOL_VERSION } from "@t3tools/contracts";
import { afterEach, expect, it } from "vite-plus/test";

// The desktop and the service launcher SIGKILL a backend 5s after asking it to
// stop, and a relaunch inside that window finds the T3 home still locked.
const SHUTDOWN_BUDGET_MS = 5_000;
const BIN_PATH = NodeURL.fileURLToPath(new URL("./bin.ts", import.meta.url));

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).toReversed()) cleanup();
});

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = NodeNet.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address() as NodeNet.AddressInfo;
      probe.close(() => resolve(address.port));
    });
  });

const startServer = async () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-shutdown-"));
  cleanups.push(() => NodeFS.rmSync(home, { recursive: true, force: true }));
  const port = await freePort();
  const bootstrapToken = NodeCrypto.randomUUID();
  const child = NodeChildProcess.spawn(process.execPath, [BIN_PATH, "--bootstrap-fd", "3"], {
    cwd: home,
    // Provider probes run at startup; keep their CLI state out of the real home.
    env: { ...process.env, HOME: home, T3CODE_HOME: "" },
    stdio: ["ignore", "pipe", "pipe", "pipe"],
  });
  cleanups.push(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  (child.stdio[3] as NodeNet.Socket).end(
    JSON.stringify({
      mode: "desktop",
      noBrowser: true,
      port,
      t3Home: home,
      host: "127.0.0.1",
      desktopBootstrapToken: bootstrapToken,
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
    }),
  );
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const onData = (data: Buffer) => {
      output = (output + data.toString()).slice(-16_384);
      if (output.includes("V2 orchestration recovery completed")) resolve();
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    void exited.then(() => reject(new Error(`server exited during startup:\n${output}`)));
  });
  return { child, exited, origin: `http://127.0.0.1:${port}`, bootstrapToken };
};

const authenticate = async (origin: string, bootstrapToken: string) => {
  const tokenResponse = await fetch(`${origin}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: bootstrapToken,
      subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    }),
  });
  const { access_token } = (await tokenResponse.json()) as { access_token: string };
  const ticketResponse = await fetch(`${origin}/api/auth/websocket-ticket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const { ticket } = (await ticketResponse.json()) as { ticket: string };
  return ticket;
};

// Completes the upgrade and then never reads or writes again, like a phone
// that went to sleep with the app open.
const openFrozenWebSocket = (origin: string, ticket: string) =>
  new Promise<NodeNet.Socket>((resolve, reject) => {
    const request = NodeHttp.request(
      `${origin}/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION}&wsTicket=${encodeURIComponent(ticket)}`,
      {
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": NodeCrypto.randomBytes(16).toString("base64"),
        },
      },
    );
    request.once("upgrade", (_response, socket) => {
      socket.pause();
      resolve(socket);
    });
    request.once("response", (response) =>
      reject(new Error(`websocket upgrade refused with ${response.statusCode}`)),
    );
    request.once("error", reject);
    request.end();
  });

it("releases the T3 home promptly when a client never answers the WebSocket close", async () => {
  const server = await startServer();
  const ticket = await authenticate(server.origin, server.bootstrapToken);
  const socket = await openFrozenWebSocket(server.origin, ticket);
  cleanups.push(() => socket.destroy());

  const stopRequestedAt = performance.now();
  server.child.kill("SIGTERM");
  await server.exited;

  expect(performance.now() - stopRequestedAt).toBeLessThan(SHUTDOWN_BUDGET_MS);
});

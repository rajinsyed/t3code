// @effect-diagnostics nodeBuiltinImport:off
// The installer must outlive this app (it replaces the running bundle), which
// Effect's scoped ChildProcess cannot express: it kills the child when the scope closes.
/**
 * A fork built by scripts/fork/build-mac.sh has no binary feed of its own. It keeps
 * the official nightly feed for checks and release notes, and replaces the two
 * steps that would swap in the official app: "download" rebases the fork's
 * checkout onto the new nightly and builds it, and "install" hands the build to
 * install-mac.sh, which waits for this app to quit, swaps it in, and reopens it.
 */
import * as NodeChildProcess from "node:child_process";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { autoUpdater } from "electron-updater";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronUpdater from "../electron/ElectronUpdater.ts";

// Written next to app-update.yml by build-mac.sh; official builds never carry it.
const FORK_UPDATE_CONFIG_FILE = "fork-update.json";
const decodeForkUpdateConfig = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ repoRoot: Schema.String })),
);
const PROGRESS_LINE = /^fork-update: progress (\d+)$/;
const ERROR_LINE = /^fork-update: error (.+)$/;

// The update UI shows this message, so it carries the script's reason.
class ForkDownloadError extends ElectronUpdater.ElectronUpdaterDownloadUpdateError {
  override get message(): string {
    return this.cause instanceof Error ? this.cause.message : super.message;
  }
}

// DesktopUpdates follows electron-updater's events, so the fork reports through them too.
function emitUpdaterEvent(event: "download-progress" | "update-downloaded", info: object): void {
  (autoUpdater as unknown as NodeJS.EventEmitter).emit(event, info);
}

export const layer = Layer.effect(
  ElectronUpdater.ElectronUpdater,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const electronApp = yield* ElectronApp.ElectronApp;

    const config = yield* fileSystem
      .readFileString(environment.path.join(environment.resourcesPath, FORK_UPDATE_CONFIG_FILE))
      .pipe(Effect.flatMap(decodeForkUpdateConfig), Effect.option);
    if (Option.isNone(config)) return ElectronUpdater.make;

    const { repoRoot } = config.value;
    const script = (name: string) => environment.path.join(repoRoot, "scripts", "fork", name);
    const logPath = environment.path.join(repoRoot, "release", "fork-update.log");
    const downloadError = (reason: string) =>
      new ForkDownloadError({
        channel: autoUpdater.channel,
        cause: new Error(`${reason} Full log: ${logPath}`),
      });

    let availableVersion: string | null = null;
    yield* ElectronUpdater.make.on("update-available", (info: { readonly version: string }) => {
      availableVersion = info.version;
    });

    const build = Effect.fn("desktop.updates.fork.build")(function* (version: string) {
      let failure: string | null = null;
      const exitCode = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(environment.path.dirname(logPath), { recursive: true });
          const child = yield* spawner.spawn(
            ChildProcess.make(
              "/bin/bash",
              [script("update-mac.sh"), "--build-only", `v${version}`],
              {
                cwd: repoRoot,
                stdin: "ignore",
                stdout: "pipe",
                stderr: "pipe",
              },
            ),
          );
          yield* child.all.pipe(
            Stream.decodeText,
            Stream.splitLines,
            Stream.tap((line) =>
              Effect.sync(() => {
                const percent = PROGRESS_LINE.exec(line)?.[1];
                if (percent) emitUpdaterEvent("download-progress", { percent: Number(percent) });
                failure = ERROR_LINE.exec(line)?.[1] ?? failure;
              }),
            ),
            Stream.map((line) => `${line}\n`),
            Stream.encodeText,
            Stream.run(fileSystem.sink(logPath)),
          );
          return yield* child.exitCode;
        }),
      ).pipe(
        Effect.mapError((error) => downloadError(`Could not run the fork build: ${error.message}`)),
      );
      if (exitCode !== 0) {
        return yield* downloadError(failure ?? `The fork build failed (exit code ${exitCode}).`);
      }
    });

    return ElectronUpdater.ElectronUpdater.of({
      ...ElectronUpdater.make,
      downloadUpdate: Effect.suspend(() => {
        const version = availableVersion;
        if (version === null) {
          return Effect.fail(downloadError("No update to build. Check for updates first."));
        }
        return build(version).pipe(
          Effect.andThen(Effect.sync(() => emitUpdaterEvent("update-downloaded", { version }))),
        );
      }),
      // The installer waits for this pid to exit, so the usual graceful quit
      // runs first. It appends its output to the same log.
      quitAndInstall: ({ isSilent, isForceRunAfter }) =>
        Effect.try({
          try: () => {
            NodeChildProcess.spawn(
              "/bin/bash",
              [script("install-mac.sh"), "--after-quit", String(process.pid)],
              { cwd: repoRoot, detached: true, stdio: "ignore" },
            ).unref();
          },
          catch: (cause) =>
            new ElectronUpdater.ElectronUpdaterQuitAndInstallError({
              channel: autoUpdater.channel,
              isSilent,
              isForceRunAfter,
              cause,
            }),
        }).pipe(Effect.andThen(electronApp.quit)),
    });
  }),
);

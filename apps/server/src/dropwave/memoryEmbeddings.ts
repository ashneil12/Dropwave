// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalTimers:off - worker_threads + node:fs for the
// embeddings flag file; hashing goes through Effect Digest.
// Memory v2 local embeddings (modelled on Row-Bot's local-embeddings extra,
// Apache-2.0). A worker thread runs @huggingface/transformers with
// bge-small-en-v1.5 (q8, 384 dims, ~33MB) so recall never blocks the server
// event loop and no text leaves the machine.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeWorkerThreads from "node:worker_threads";

import type { DropwaveMemoryItem, DropwaveOperationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import type { DropwaveStoreShape } from "./DropwaveStore.ts";

/** @public */
export const MEMORY_EMBEDDING_MODEL_ID = "Xenova/bge-small-en-v1.5";
/** @public */
export const MEMORY_EMBEDDING_DIM = 384;

export class MemoryEmbeddingError extends Schema.TaggedError<MemoryEmbeddingError>()(
  "MemoryEmbeddingError",
  {
    reason: Schema.Literals(["disabled", "unavailable", "worker_failed"]),
    message: Schema.String,
  },
) {}

export interface MemoryEmbeddingStatus {
  readonly state: "disabled" | "loading" | "ready" | "error";
  readonly modelId: string;
  readonly dim: number;
  readonly enabled: boolean;
  readonly lastError?: string;
  /** 0..1 model download progress while state is "loading". */
  readonly progress?: number;
}

export interface MemoryEmbeddingsShape {
  readonly status: Effect.Effect<MemoryEmbeddingStatus>;
  readonly setEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly embed: (
    texts: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<Float32Array>, MemoryEmbeddingError>;
}

export class MemoryEmbeddings extends Context.Service<MemoryEmbeddings, MemoryEmbeddingsShape>()(
  "t3/dropwave/memoryEmbeddings",
) {}

// Only meaning fields are embedded — never provenance (quotes, message ids).
/** @public */
export function memoryEmbedSource(item: {
  readonly kind: string;
  readonly subject: string;
  readonly text: string;
  readonly aliases: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
}): string {
  return [item.kind, item.subject, item.text, ...item.aliases, ...item.tags]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ")
    .slice(0, 2000);
}

/** @public */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const dim = Math.min(a.length, b.length);
  let dot = 0;
  for (let index = 0; index < dim; index += 1) dot += a[index]! * b[index]!;
  return dot;
}

interface WorkerReply {
  readonly id?: number;
  readonly type?: string;
  readonly vectors?: ReadonlyArray<ReadonlyArray<number>>;
  readonly error?: string;
  readonly progress?: number;
}

const EMBED_TIMEOUT = "60 seconds";
const LOAD_TIMEOUT = "150 seconds";

export const layer: Layer.Layer<MemoryEmbeddings, never, ServerConfig.ServerConfig> = Layer.effect(
  MemoryEmbeddings,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const settingsPath = NodePath.join(config.stateDir, "memory-embeddings.json");
    const modelCacheDir = NodePath.join(config.stateDir, "memory-embeddings-cache");

    const readEnabled = (): boolean => {
      try {
        const parsed = JSON.parse(NodeFS.readFileSync(settingsPath, "utf8")) as {
          enabled?: boolean;
        };
        return parsed.enabled !== false;
      } catch {
        return true;
      }
    };
    const writeEnabled = (value: boolean): void => {
      NodeFS.mkdirSync(config.stateDir, { recursive: true });
      NodeFS.writeFileSync(settingsPath, JSON.stringify({ enabled: value }), "utf8");
    };

    let enabled = readEnabled();
    let worker: NodeWorkerThreads.Worker | undefined;
    let workerState: MemoryEmbeddingStatus["state"] = enabled ? "loading" : "disabled";
    let lastError: string | undefined;
    let downloadProgress: number | undefined;
    let nextRequestId = 1;
    const pending = new Map<
      number,
      { resolve: (vectors: ReadonlyArray<Float32Array>) => void; reject: (e: Error) => void }
    >();

    const setState = (state: MemoryEmbeddingStatus["state"], error?: string) => {
      workerState = state;
      lastError = error;
    };
    const failPending = (message: string) => {
      for (const entry of pending.values()) entry.reject(new Error(message));
      pending.clear();
    };

    const waitForReady = Effect.fnUntraced(function* (spawned: NodeWorkerThreads.Worker) {
      yield* Effect.callback<void, MemoryEmbeddingError>((resume) => {
        const onMessage = (reply: WorkerReply) => {
          if (reply.type === "ready") {
            spawned.off("message", onMessage);
            resume(Effect.void);
          } else if (reply.type === "error") {
            spawned.off("message", onMessage);
            resume(
              Effect.fail(
                new MemoryEmbeddingError({
                  reason: "worker_failed",
                  message: reply.error ?? "embedding model failed to load",
                }),
              ),
            );
          }
        };
        spawned.on("message", onMessage);
        return Effect.sync(() => spawned.off("message", onMessage));
      }).pipe(
        Effect.timeoutOrElse({
          duration: LOAD_TIMEOUT,
          orElse: () =>
            Effect.fail(
              new MemoryEmbeddingError({
                reason: "worker_failed",
                message: "embedding model load timed out",
              }),
            ),
        }),
      );
    });

    const spawnWorker = Effect.fnUntraced(function* () {
      setState("loading");
      const spawned = new NodeWorkerThreads.Worker(
        new URL("./memoryEmbeddingWorker.ts", import.meta.url),
        { workerData: { cacheDir: modelCacheDir } },
      );
      worker = spawned;
      spawned.on("message", (reply: WorkerReply) => {
        if (reply.type === "progress") {
          downloadProgress = reply.progress;
          return;
        }
        if (reply.type === "ready" || reply.type === "error") return;
        if (reply.id === undefined) return;
        const entry = pending.get(reply.id);
        if (entry === undefined) return;
        pending.delete(reply.id);
        if (reply.error !== undefined || reply.vectors === undefined) {
          entry.reject(new Error(reply.error ?? "embedding worker returned no vectors"));
          return;
        }
        entry.resolve(
          reply.vectors.map((vector) => {
            const floats = new Float32Array(vector.length);
            for (let index = 0; index < vector.length; index += 1) {
              floats[index] = vector[index] ?? 0;
            }
            return floats;
          }),
        );
      });
      spawned.on("error", (cause) => {
        setState("error", cause instanceof Error ? cause.message : String(cause));
        failPending("embedding worker crashed");
        if (worker === spawned) worker = undefined;
      });
      spawned.on("exit", (code) => {
        if (code !== 0 && worker === spawned) {
          setState("error", `embedding worker exited ${code}`);
          failPending("embedding worker exited");
          worker = undefined;
        }
      });
      yield* waitForReady(spawned);
      downloadProgress = undefined;
      setState("ready");
    });

    const embed = Effect.fn("MemoryEmbeddings.embed")(function* (
      texts: ReadonlyArray<string>,
    ): Effect.fn.Return<ReadonlyArray<Float32Array>, MemoryEmbeddingError> {
      if (!enabled) {
        return yield* new MemoryEmbeddingError({
          reason: "disabled",
          message: "Local embeddings are turned off in Settings.",
        });
      }
      if (texts.length === 0) return [];
      if (worker === undefined || workerState === "error") {
        const loaded = yield* spawnWorker().pipe(
          Effect.as(true),
          Effect.catch(() =>
            Effect.sync(() => {
              if (worker !== undefined) {
                worker.terminate().catch(() => undefined);
                worker = undefined;
              }
              return false;
            }),
          ),
        );
        void loaded;
        if (worker === undefined || workerState !== "ready") {
          return yield* new MemoryEmbeddingError({
            reason: "unavailable",
            message: lastError ?? "embedding worker is unavailable",
          });
        }
      }
      const active = worker;
      const id = nextRequestId;
      nextRequestId += 1;
      return yield* Effect.callback<ReadonlyArray<Float32Array>, MemoryEmbeddingError>((resume) => {
        pending.set(id, {
          resolve: (value) => resume(Effect.succeed(value)),
          reject: (cause) =>
            resume(
              Effect.fail(
                new MemoryEmbeddingError({ reason: "worker_failed", message: cause.message }),
              ),
            ),
        });
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads ports take no origin
        active.postMessage({ id, texts: [...texts] });
        return Effect.sync(() => pending.delete(id));
      }).pipe(
        Effect.timeoutOrElse({
          duration: EMBED_TIMEOUT,
          orElse: () =>
            Effect.fail(
              new MemoryEmbeddingError({
                reason: "worker_failed",
                message: "embedding request timed out",
              }),
            ),
        }),
      );
    });

    const status = Effect.sync((): MemoryEmbeddingStatus => ({
      state: !enabled ? "disabled" : workerState,
      modelId: MEMORY_EMBEDDING_MODEL_ID,
      dim: MEMORY_EMBEDDING_DIM,
      enabled,
      ...(workerState === "loading" && downloadProgress !== undefined
        ? { progress: downloadProgress }
        : {}),
      ...(lastError !== undefined ? { lastError } : {}),
    }));

    const setEnabledFlag = Effect.fn("MemoryEmbeddings.setEnabled")((value: boolean) =>
      Effect.sync(() => {
        enabled = value;
        writeEnabled(value);
        if (!value && worker !== undefined) {
          worker.terminate().catch(() => undefined);
          worker = undefined;
          setState("disabled");
        } else if (value && workerState === "disabled") {
          setState("loading");
        }
      }),
    );

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (worker !== undefined) {
          failPending("server shutting down");
          worker.terminate().catch(() => undefined);
          worker = undefined;
        }
      }),
    );

    // Every embed() caller gates on status "ready", so the lazy spawn inside
    // embed() is unreachable: without this the model never downloads and
    // vectors stay off forever. Warm the worker in the background when the
    // feature is enabled; recall keeps using FTS until it reports ready.
    if (enabled) {
      yield* spawnWorker().pipe(
        Effect.catch((cause) =>
          Effect.sync(() => {
            setState("error", cause.message);
            if (worker !== undefined) {
              worker.terminate().catch(() => undefined);
              worker = undefined;
            }
          }),
        ),
        Effect.forkScoped,
      );
    }

    return MemoryEmbeddings.of({ status, setEnabled: setEnabledFlag, embed });
  }),
);

/** @public */
export const layerMemory: Layer.Layer<MemoryEmbeddings> = Layer.succeed(
  MemoryEmbeddings,
  MemoryEmbeddings.of({
    status: Effect.succeed({
      state: "disabled",
      modelId: MEMORY_EMBEDDING_MODEL_ID,
      dim: MEMORY_EMBEDDING_DIM,
      enabled: false,
    }),
    setEnabled: Effect.fnUntraced(function* () {
      yield* Effect.void;
    }),
    embed: Effect.fnUntraced(function* () {
      return yield* new MemoryEmbeddingError({
        reason: "disabled",
        message: "Local embeddings are unavailable in tests.",
      });
    }),
  }),
);

// Content hash over exactly what gets embedded, so provenance edits never
// trigger a re-embed and meaning edits always do.
/** @public */
export const memoryContentHash = Effect.fnUntraced(function* (
  digester: {
    readonly digestHex: (algorithm: Digest.Algorithm, data: Uint8Array) => Effect.Effect<string>;
  },
  item: {
    readonly kind: string;
    readonly subject: string;
    readonly text: string;
    readonly aliases: ReadonlyArray<string>;
    readonly tags: ReadonlyArray<string>;
  },
): Effect.fn.Return<string> {
  return yield* digester.digestHex(
    Digest.sha256,
    new TextEncoder().encode(memoryEmbedSource(item)),
  );
});

// Ensure every item has a current vector for the active model; returns how
// many were (re)embedded. Missing/stale hashes and model-id changes re-embed.
/** @public */
export const ensureMemoryVectors = Effect.fnUntraced(function* (
  store: DropwaveStoreShape,
  embeddings: MemoryEmbeddingsShape,
  items: ReadonlyArray<DropwaveMemoryItem>,
): Effect.fn.Return<number, MemoryEmbeddingError | DropwaveOperationError, Digest.Digest> {
  const digester = yield* Digest.Digest;
  const modelId = MEMORY_EMBEDDING_MODEL_ID;
  const hashes = new Map<string, string>();
  for (const item of items) {
    hashes.set(item.id, yield* memoryContentHash(digester, item));
  }
  const existing = yield* store.getMemoryVectors(
    items.map((item) => item.id),
    modelId,
  );
  const stale = items.filter((item) => {
    const vector = existing.get(item.id);
    return vector === undefined || vector.contentHash !== hashes.get(item.id);
  });
  if (stale.length === 0) return 0;
  const vectors = yield* embeddings.embed(stale.map((item) => memoryEmbedSource(item)));
  for (const [index, item] of stale.entries()) {
    yield* store.putMemoryVector({
      itemId: item.id,
      modelId,
      dim: MEMORY_EMBEDDING_DIM,
      vector: vectors[index]!,
      contentHash: hashes.get(item.id)!,
    });
  }
  return stale.length;
});

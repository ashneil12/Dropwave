// oxlint-disable unicorn/require-post-message-target-origin -- worker_threads ports take no origin
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - worker entry, no Effect runtime.
// Local embedding worker for Memory v2 (modelled on Row-Bot's local-embeddings
// extra, Apache-2.0). Loads bge-small-en-v1.5 once and mean-pools + L2
// normalizes each text so cosine similarity is a dot product.
import * as NodeWorkerThreads from "node:worker_threads";

import { env, pipeline } from "@huggingface/transformers";

const { parentPort, workerData } = NodeWorkerThreads;

const MODEL_ID = "Xenova/bge-small-en-v1.5";
const DTYPE = "q8";

interface EmbedRequest {
  readonly id: number;
  readonly texts: ReadonlyArray<string>;
}

async function main(): Promise<void> {
  if (parentPort === null) return;
  const cacheDir =
    typeof workerData === "object" && workerData !== null && "cacheDir" in workerData
      ? String((workerData as { cacheDir?: string }).cacheDir)
      : undefined;
  if (cacheDir !== undefined && cacheDir !== "") {
    env.cacheDir = cacheDir;
  }
  env.allowLocalModels = false;

  const extractor = await pipeline("feature-extraction", MODEL_ID, {
    dtype: DTYPE,
    progress_callback: (progress: { status?: string; file?: string; progress?: number }) => {
      parentPort?.postMessage({
        type: "progress",
        status: progress.status ?? "",
        file: progress.file ?? "",
        progress: typeof progress.progress === "number" ? progress.progress : 0,
      });
    },
  });
  parentPort.postMessage({ type: "ready", modelId: MODEL_ID, dim: 384 });

  parentPort.on("message", (message: unknown) => {
    const request = message as EmbedRequest;
    void (async () => {
      try {
        const vectors: Array<Array<number>> = [];
        for (const text of request.texts) {
          const output = await extractor(text, { pooling: "mean", normalize: true });
          vectors.push(Array.from(output.data as Float32Array));
        }
        parentPort?.postMessage({ id: request.id, vectors });
      } catch (cause) {
        parentPort?.postMessage({
          id: request.id,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    })();
  });
}

void main().catch((cause) => {
  parentPort?.postMessage({
    type: "error",
    error: cause instanceof Error ? cause.message : String(cause),
  });
});

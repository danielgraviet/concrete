import { handleRequest } from "./app";
import { createFirebaseVerifier } from "./auth";
import { BurstLimiter } from "./burst";
import { loadConfig, type Env } from "./config";
import { D1QuotaStore } from "./quota";
import { D1StorageStore } from "./storage";

export type { Env } from "./config";

// Isolate-scoped so the limiter state survives across requests handled by this isolate.
const burst = new BurstLimiter(5, 10, 60_000);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const config = loadConfig(env);
    return handleRequest(req, {
      config,
      verifyToken: createFirebaseVerifier(config.firebaseProjectId),
      quota: new D1QuotaStore(env.DB),
      upstream: {
        apiKey: env.OPENROUTER_API_KEY ?? "",
        appUrl: config.appUrl,
        fetch: (input, init) => fetch(input, init),
      },
      ...(env.FILES ? { files: { bucket: env.FILES, storage: new D1StorageStore(env.DB) } } : {}),
      burst,
      waitUntil: (p) => ctx.waitUntil(p),
      log: (entry) => console.log(JSON.stringify(entry)),
    });
  },
} satisfies ExportedHandler<Env>;

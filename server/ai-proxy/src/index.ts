import Anthropic from "@anthropic-ai/sdk";
import { handleRequest, type ModelClient } from "./app";
import { createFirebaseVerifier } from "./auth";
import { BurstLimiter } from "./burst";
import { loadConfig, type Env } from "./config";
import { D1QuotaStore } from "./quota";

export type { Env } from "./config";

// Isolate-scoped so the limiter state survives across requests handled by this isolate.
const burst = new BurstLimiter(5, 10, 60_000);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const config = loadConfig(env);
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const model: ModelClient = { stream: (params) => client.messages.stream(params) };
    return handleRequest(req, {
      config,
      verifyToken: createFirebaseVerifier(config.firebaseProjectId),
      quota: new D1QuotaStore(env.DB),
      model,
      burst,
      waitUntil: (p) => ctx.waitUntil(p),
      log: (entry) => console.log(JSON.stringify(entry)),
    });
  },
} satisfies ExportedHandler<Env>;

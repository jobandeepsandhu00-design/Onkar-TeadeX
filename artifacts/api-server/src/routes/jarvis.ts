import { Router, type IRouter, type Request, type Response } from "express";
import { jarvisDecisionSchema, jarvisRequestSchema } from "@workspace/api-zod";
import { requireSupabaseUser } from "../lib/supabase-auth";
import { ScannerError, ScannerStore } from "../market-brain/store";
import {
  createJarvisCommand,
  decideJarvisCommand,
  getJarvisCommand,
  jarvisCapabilities,
} from "../onkar-ai/jarvis-service";
const router: IRouter = Router();
function route(
  handler: (
    req: Request,
    res: Response,
    identity: Awaited<ReturnType<typeof requireSupabaseUser>>,
  ) => Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (process.env.ONKAR_JARVIS_ENABLED === "false")
        throw new ScannerError("Jarvis is disabled by server policy.", 503);
      let identity;
      try {
        identity = await requireSupabaseUser(req.headers.authorization);
      } catch {
        throw new ScannerError("Sign in again to use Jarvis.", 401);
      }
      await handler(req, res, identity);
    } catch (error) {
      res
        .status(error instanceof ScannerError ? error.status : 500)
        .json({
          error:
            error instanceof ScannerError
              ? error.message
              : "Jarvis is unavailable. No completion is assumed; check system status before retrying.",
        });
    }
  };
}
router.get(
  "/onkar-ai/jarvis/capabilities",
  route(async (_req, res) => {
    res.json({
      capabilities: jarvisCapabilities,
      liveTradingByVoice: false,
      microphone: "explicit consent; on-device wake only when supported",
    });
  }),
);
router.get(
  "/onkar-ai/jarvis/history",
  route(async (_req, res, identity) => {
    const rows = await ScannerStore.user(identity).request<
      Array<{ id: string; output: unknown; created_at: string }>
    >("onkar_agent_runs", {
      user_id: `eq.${identity.userId}`,
      intent: "eq.JARVIS_COMMAND",
      select: "id,output,created_at",
      order: "created_at.desc",
      limit: "20",
    });
    res.json(rows);
  }),
);
router.post(
  "/onkar-ai/jarvis/commands",
  route(async (req, res, identity) => {
    const parsed = jarvisRequestSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ScannerError("Invalid or unsupported command arguments.", 400);
    res.json(
      await createJarvisCommand(
        identity,
        parsed.data.requestId,
        parsed.data.action,
      ),
    );
  }),
);
const id = (req: Request) => {
  const value = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(value))
    throw new ScannerError("Invalid command ID.", 400);
  return value;
};
router.get(
  "/onkar-ai/jarvis/commands/:id",
  route(async (req, res, identity) => {
    res.json(await getJarvisCommand(identity, id(req)));
  }),
);
router.post(
  "/onkar-ai/jarvis/commands/:id",
  route(async (req, res, identity) => {
    const parsed = jarvisDecisionSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ScannerError("Use the exact on-screen confirmation.", 400);
    res.json(
      await decideJarvisCommand(
        identity,
        id(req),
        parsed.data.decision,
        parsed.data.nonce,
      ),
    );
  }),
);
export default router;

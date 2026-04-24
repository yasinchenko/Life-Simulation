import { Router, type IRouter } from "express";
import { simulationEngine } from "../lib/simulation-engine";
import {
  GetConfigResponse,
  UpdateConfigBody,
  UpdateConfigResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/config", (_req, res): void => {
  const config = simulationEngine.getConfig();
  res.json(GetConfigResponse.parse(config));
});

router.put("/config", async (req, res): Promise<void> => {
  const parsed = UpdateConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await simulationEngine.updateConfig(parsed.data);
  res.json(UpdateConfigResponse.parse(updated));
});

export default router;

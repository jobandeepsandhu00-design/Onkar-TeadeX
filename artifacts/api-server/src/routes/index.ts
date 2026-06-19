import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import stateRouter from "./state";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(stateRouter);

export default router;

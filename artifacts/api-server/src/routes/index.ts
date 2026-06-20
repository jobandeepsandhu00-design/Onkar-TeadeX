import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import stateRouter from "./state";
import calendarRouter from "./calendar";
import marketRouter from "./market";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(stateRouter);
router.use(calendarRouter);
router.use(marketRouter);

export default router;

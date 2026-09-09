import { Router, type IRouter } from "express";
import healthRouter from "./health";
import calendarRouter from "./calendar";
import marketRouter from "./market";
import mtImportRouter from "./mt-import";
import backtestRouter from "./backtest";
import legacyReadRouter from "./legacy-read";
import videoLessonsRouter from "./video-lessons";
import mediaRouter from "./media";

const router: IRouter = Router();

router.use(healthRouter);
router.use(calendarRouter);
router.use(marketRouter);
router.use(mtImportRouter);
router.use(backtestRouter);
router.use(legacyReadRouter);
router.use(videoLessonsRouter);
router.use(mediaRouter);

export default router;

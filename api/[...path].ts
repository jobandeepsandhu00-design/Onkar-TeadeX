import app from "../artifacts/api-server/src/app";

// Vercel invokes exported Express apps as Node.js serverless functions.
// The catch-all filename preserves the original /api/* request path so the
// application's existing router works unchanged.
export default app;
import app from "../artifacts/api-server/dist/vercel.mjs";

export default function handler(req, res) {
  const requestUrl = new URL(req.url || "/", "http://localhost");
  const apiPath = requestUrl.searchParams.get("__api_path") || "";
  requestUrl.searchParams.delete("__api_path");

  const query = requestUrl.searchParams.toString();
  req.url = `/api/${apiPath}${query ? `?${query}` : ""}`;

  return app(req, res);
}
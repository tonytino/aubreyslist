import { createAPIFileRoute } from "@tanstack/react-start/api";
import app from "../server/index";

// Hand every method off to the Hono app, including OPTIONS (CORS preflight)
// and HEAD — otherwise those requests never reach Hono and fail at this layer.
const handler = ({ request }: { request: Request }) => app.fetch(request);

export const APIRoute = createAPIFileRoute("/api/$")({
  GET: handler,
  POST: handler,
  PUT: handler,
  PATCH: handler,
  DELETE: handler,
  OPTIONS: handler,
  HEAD: handler,
});

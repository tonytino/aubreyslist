import { createAPIFileRoute } from "@tanstack/react-start/api";
import app from "../server/index";

export const APIRoute = createAPIFileRoute("/api/$")({
  GET: ({ request }) => app.fetch(request),
  POST: ({ request }) => app.fetch(request),
  PUT: ({ request }) => app.fetch(request),
  PATCH: ({ request }) => app.fetch(request),
  DELETE: ({ request }) => app.fetch(request),
});

// Global TanStack Start configuration (AUB-110).
//
// `createStart` lets us register global middleware that runs on EVERY request
// (`requestMiddleware`) and EVERY server-function call (`functionMiddleware`).
// We install Sentry's global middleware as the FIRST entry in each chain so it
// wraps all downstream middleware and handlers — that ordering is what lets
// Sentry attach a trace/scope around the entire request before any of our own
// logic runs, and surface errors thrown deeper in the chain.
//
// This file previously did not exist (the framework used its defaults); we add
// it to seat the Sentry middleware and (AUB-162 / AUB-174) a global request
// middleware that hardens SSR/document + server-function responses with the
// security header set and enforces the same-origin (CSRF) check on
// state-changing server-function calls. Keep the Sentry entries first so they
// wrap everything downstream.
import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from "@sentry/tanstackstart-react";
import { createMiddleware, createStart } from "@tanstack/react-start";
import { applySecurityHeaders, hstsEnabled } from "~/server/security/headers";
import { originGuardResponse } from "~/server/security/origin";

/**
 * Global request middleware for the TanStack Start surface (documents + server
 * functions). The Hono `/api/*` surface has its own equivalent middleware in
 * `app/server/index.ts`, so we skip `/api` paths here to avoid double-owning
 * that surface (its responses are produced by Hono, not this handler).
 *
 * On the way IN: reject state-changing cross-origin server-function calls with a
 * 403 before any handler/DB work (AUB-174). SSR document navigations are GET, so
 * they pass through untouched; a POST server-function call carries the browser's
 * `Origin`, which must match the serving host.
 *
 * On the way OUT: stamp the security headers onto the response (AUB-162).
 */
const securityMiddleware = createMiddleware({ type: "request" }).server(
  async ({ request, pathname, next }) => {
    // Exact-boundary match: "/api" or "/api/..." only — NOT a future page
    // route that merely starts with the literal "api" (e.g. "/api-status").
    const isApi = pathname === "/api" || pathname.startsWith("/api/");

    if (!isApi) {
      const rejection = originGuardResponse(request);
      if (rejection) {
        applySecurityHeaders(rejection, { hsts: hstsEnabled() });
        return rejection;
      }
    }

    const result = await next();

    if (!isApi) {
      applySecurityHeaders(result.response, { hsts: hstsEnabled() });
    }

    return result;
  }
);

export const startInstance = createStart(() => {
  return {
    requestMiddleware: [sentryGlobalRequestMiddleware, securityMiddleware],
    functionMiddleware: [sentryGlobalFunctionMiddleware],
  };
});

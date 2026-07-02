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
// it solely to seat the Sentry middleware. Keep the Sentry entries first if
// other global middleware is added later.
import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from "@sentry/tanstackstart-react";
import { createStart } from "@tanstack/react-start";

export const startInstance = createStart(() => {
  return {
    requestMiddleware: [sentryGlobalRequestMiddleware],
    functionMiddleware: [sentryGlobalFunctionMiddleware],
  };
});

import { runWithStartContext } from "@tanstack/start-storage-context";

/**
 * Invoke a TanStack Start server function in a unit test.
 *
 * Since the vinxi→Vite-plugin migration (TanStack Start 1.120+, issue #198),
 * calling a `createServerFn(...)` value directly runs the framework's middleware
 * pipeline, which reads the per-request "Start context" out of an
 * `AsyncLocalStorage`. Outside the server runtime that store is empty, so a bare
 * call throws `No Start context found in AsyncLocalStorage`. In production the
 * request handler populates it; in tests we supply a minimal context here.
 *
 * This does NOT stub or weaken anything the function does — validation, the
 * auth/rate-limit guards, and the handler body all run exactly as in production.
 * It only provides the ambient request context the pipeline now expects. The
 * `request` is a placeholder POST (server fns default to POST); tests that assert
 * on the request can pass their own via `request`.
 *
 * Usage: `await callServerFn(() => myServerFn({ data: { ... } }))`.
 */
export function callServerFn<T>(fn: () => T | Promise<T>, request?: Request): Promise<T> {
  return runWithStartContext(
    {
      // The pipeline only reads `request` and `contextAfterGlobalMiddlewares`
      // on the server path; the rest satisfy the context's type contract and
      // are never exercised by a direct in-process call.
      request: request ?? new Request("http://localhost/_serverFn", { method: "POST" }),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
      startOptions: {},
      handlerType: "serverFn",
      getRouter: () => {
        throw new Error("getRouter is not available in unit tests");
      },
    },
    fn
  );
}

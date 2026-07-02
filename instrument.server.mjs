// Server-side Sentry initialization (AUB-110).
//
// This module MUST be imported/evaluated BEFORE any other server code so that
// Sentry's auto-instrumentation can patch Node internals (http, fetch, etc.)
// as early as possible. The production `--import` wiring that guarantees that
// ordering lives in a separate task (AUB-106) — this file only owns the
// `Sentry.init(...)` call itself.
//
// The DSN below is a PUBLIC client key: it only identifies which Sentry
// project to send events to and carries no privileged access, so committing it
// is safe and expected (see Sentry's docs on DSNs).
//
// PII / `sendDefaultPii` and other data-collection tuning is deliberately left
// at library defaults here — that decision is tracked as its own issue.
import * as Sentry from "@sentry/tanstackstart-react";

Sentry.init({
  dsn: "https://b2412423a23e64a7b4e783b748ae8fbd@o4511662074167296.ingest.us.sentry.io/4511662076592133",
});

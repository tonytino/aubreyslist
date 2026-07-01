import * as Sentry from "@sentry/tanstackstart-react";

/**
 * Client-side Sentry initialization. Imported first in `app/client.tsx` so the
 * SDK is initialized before hydration and can capture browser errors.
 *
 * The DSN is a public identifier (safe to commit). `dataCollection`/PII options
 * are intentionally left at library defaults here — a deliberate PII-scrubbing
 * decision is tracked separately.
 */
Sentry.init({
  dsn: "https://b2412423a23e64a7b4e783b748ae8fbd@o4511662074167296.ingest.us.sentry.io/4511662076592133",
});

import * as Sentry from "@sentry/tanstackstart-react";

/**
 * Client-side Sentry initialization. Imported first in `app/client.tsx` so the
 * SDK captures browser errors from before hydration.
 *
 * The DSN is a public identifier, safe to commit. PII options stay at library
 * defaults.
 */
Sentry.init({
  dsn: "https://b2412423a23e64a7b4e783b748ae8fbd@o4511662074167296.ingest.us.sentry.io/4511662076592133",
});

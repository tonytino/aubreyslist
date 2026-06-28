// @ts-nocheck — plain ESM bootstrap, run via `node --import` outside the app graph.
//
// Registers the `~/` alias resolve hook (see `alias-resolve-hook.mjs`) for the
// current Node process. Used by `pnpm db:seed-admin` via
// `node --experimental-strip-types --import ./scripts/register-aliases.mjs`.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-resolve-hook.mjs", pathToFileURL(`${import.meta.dirname}/`).href);

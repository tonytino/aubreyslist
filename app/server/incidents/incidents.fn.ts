import { createServerFn } from "@tanstack/react-start";
import {
  editIncidentInputSchema,
  listIncidentsInputSchema,
  reportIncidentInputSchema,
  retractIncidentInputSchema,
} from "~/trust/incident-recency";
import { editIncident, listIncidents, reportIncident, retractIncident } from "./index";

/**
 * Client-callable incident server functions.
 *
 * These `createServerFn` entry points are the only part of the incident
 * server layer that client code imports. Per the `*.fn.ts` convention, the
 * db-touching implementations live in `./index.ts` and the TanStack Start
 * plugin strips their handler bodies out of the browser bundle — importing
 * from here never drags `getDb` (neon/drizzle) into the client build.
 *
 * Server-only at runtime; safe to import from client modules.
 */

/** Report-incident server function (login-gated, validated). See {@link reportIncident}. */
export const submitIncident = createServerFn({ method: "POST" })
  .validator(reportIncidentInputSchema)
  .handler(({ data }) => reportIncident(data));

/** Read a listing's incidents, most-recent first. See {@link listIncidents}. */
export const fetchIncidents = createServerFn({ method: "GET" })
  .validator(listIncidentsInputSchema)
  .handler(({ data }) => listIncidents(data));

/**
 * Edit-own-incident server function (login-gated, validated, ownership enforced
 * server-side). See {@link editIncident}.
 */
export const updateIncident = createServerFn({ method: "POST" })
  .validator(editIncidentInputSchema)
  .handler(({ data }) => editIncident(data));

/**
 * Retract-own-incident server function (login-gated, validated, ownership
 * enforced server-side). See {@link retractIncident}.
 */
export const removeIncident = createServerFn({ method: "POST" })
  .validator(retractIncidentInputSchema)
  .handler(({ data }) => retractIncident(data));

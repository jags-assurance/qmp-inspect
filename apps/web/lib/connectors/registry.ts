// R21 — the single place every DocumentPlatformConnector is registered, so the UI (and any future
// server-side caller) has one list to iterate rather than importing each connector individually.
import type { DocumentPlatformConnector } from "./types";
import { aconexConnector } from "./aconex";
import { procoreConnector } from "./procore";
import { projectwiseConnector } from "./projectwise";

export const CONNECTOR_REGISTRY: DocumentPlatformConnector[] = [aconexConnector, procoreConnector, projectwiseConnector];

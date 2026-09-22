// R21 — ProjectWise connector stub. Bentley Systems' ProjectWise is typically integrated either
// via its on-prem/cloud "ProjectWise Web Services" (WSG) REST API or ProjectWise Design Integration
// APIs, both of which need a licensed Bentley/ProjectWise environment plus service credentials —
// none of which exist in this environment. isConfigured() checks for the env vars a real
// integration would need; every other method throws until those are genuinely set and a real REST
// client is written against a specific customer's ProjectWise instance (out of scope here with no
// access to test against).
import { ConnectorNotConfiguredError, type ConnectorDocument, type DocumentPlatformConnector } from "./types";

export const projectwiseConnector: DocumentPlatformConnector = {
  platformName: "ProjectWise",

  isConfigured(): boolean {
    return Boolean(process.env.PROJECTWISE_API_BASE_URL && process.env.PROJECTWISE_API_KEY);
  },

  async listDocuments(_projectRef: string): Promise<ConnectorDocument[]> {
    throw new ConnectorNotConfiguredError(this.platformName);
  },

  async importDocument(_doc: ConnectorDocument, _targetFolderId: string): Promise<void> {
    throw new ConnectorNotConfiguredError(this.platformName);
  },
};

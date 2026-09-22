// R21 — Procore connector stub. Procore's REST API uses OAuth2 (a registered "Procore App" with a
// client ID/secret from the Procore App Marketplace developer portal, plus a per-company
// connection) — none of which exist in this environment. isConfigured() checks for the env vars a
// real integration would need; every other method throws until those are genuinely set and a real
// OAuth + REST client is written against Procore's actual API (out of scope here with no access to
// test against).
import { ConnectorNotConfiguredError, type ConnectorDocument, type DocumentPlatformConnector } from "./types";

export const procoreConnector: DocumentPlatformConnector = {
  platformName: "Procore",

  isConfigured(): boolean {
    return Boolean(process.env.PROCORE_CLIENT_ID && process.env.PROCORE_CLIENT_SECRET);
  },

  async listDocuments(_projectRef: string): Promise<ConnectorDocument[]> {
    throw new ConnectorNotConfiguredError(this.platformName);
  },

  async importDocument(_doc: ConnectorDocument, _targetFolderId: string): Promise<void> {
    throw new ConnectorNotConfiguredError(this.platformName);
  },
};

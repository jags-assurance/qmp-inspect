// R21 — Aconex connector stub. Aconex (Oracle Construction and Engineering) exposes a SOAP/REST
// "Aconex API" that needs a registered application plus per-organisation user credentials/API key
// issued by Oracle — none of which exist in this environment, and there is no way to obtain a
// sandbox credential from inside this sandbox. isConfigured() checks for the env var a real
// integration would need; every other method throws until that's genuinely set and a real HTTP
// client is written against Aconex's actual API (out of scope here with no access to test against).
import { ConnectorNotConfiguredError, type ConnectorDocument, type DocumentPlatformConnector } from "./types";

export const aconexConnector: DocumentPlatformConnector = {
  platformName: "Aconex",

  isConfigured(): boolean {
    return Boolean(process.env.ACONEX_API_KEY);
  },

  async listDocuments(_projectRef: string): Promise<ConnectorDocument[]> {
    throw new ConnectorNotConfiguredError(this.platformName);
  },

  async importDocument(_doc: ConnectorDocument, _targetFolderId: string): Promise<void> {
    throw new ConnectorNotConfiguredError(this.platformName);
  },
};

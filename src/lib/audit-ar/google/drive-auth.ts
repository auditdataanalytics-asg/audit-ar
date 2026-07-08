import { OAuth2Client } from "google-auth-library";

// Credential mechanism is kept behind this interface so it can be swapped
// (e.g. to a service account) later without touching the Drive service.
export interface DriveAuthProvider {
  getAuthClient(): Promise<OAuth2Client>;
}

class RefreshTokenAuth implements DriveAuthProvider {
  private client: OAuth2Client | null = null;

  async getAuthClient(): Promise<OAuth2Client> {
    if (this.client) return this.client;
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        "Google Drive is not configured (missing GOOGLE_OAUTH_* env vars).",
      );
    }
    const client = new OAuth2Client({ clientId, clientSecret });
    client.setCredentials({ refresh_token: refreshToken });
    this.client = client;
    return client;
  }
}

export function getDriveAuthProvider(): DriveAuthProvider {
  // Future: read process.env.DRIVE_AUTH_MODE to select a service-account impl.
  return new RefreshTokenAuth();
}

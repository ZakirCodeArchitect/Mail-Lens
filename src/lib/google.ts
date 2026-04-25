import { google } from "googleapis";

import { getRequiredEnv } from "@/lib/env";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: Date | null;
  scope: string | null;
}

export interface GmailProfile {
  email: string;
}

export function createOAuthClient() {
  return new google.auth.OAuth2(
    getRequiredEnv("GOOGLE_CLIENT_ID"),
    getRequiredEnv("GOOGLE_CLIENT_SECRET"),
    getRequiredEnv("GOOGLE_REDIRECT_URI"),
  );
}

export function getGoogleAuthUrl(): string {
  const oauthClient = createOAuthClient();

  return oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_READONLY_SCOPE],
  });
}

export async function getTokensFromCode(code: string): Promise<GoogleTokens> {
  const oauthClient = createOAuthClient();
  const { tokens } = await oauthClient.getToken(code);

  if (!tokens.access_token) {
    throw new Error("Google OAuth response did not include access_token");
  }

  if (!tokens.refresh_token) {
    throw new Error(
      "Google OAuth response did not include refresh_token. Ensure prompt=consent and access_type=offline.",
    );
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope ?? null,
  };
}

export async function getGmailProfile(accessToken: string): Promise<GmailProfile> {
  const oauthClient = createOAuthClient();
  oauthClient.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: "v1", auth: oauthClient });
  const { data } = await gmail.users.getProfile({ userId: "me" });

  const email = data.emailAddress ?? null;

  if (!email) {
    throw new Error("Unable to read Gmail profile email from Gmail API");
  }

  return { email };
}

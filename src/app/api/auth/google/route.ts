import { NextResponse } from "next/server";

import { getGoogleAuthUrl } from "@/lib/google";

export async function GET() {
  try {
    const authUrl = getGoogleAuthUrl();
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error("Failed to generate Google OAuth URL", error);
    return NextResponse.json(
      { error: "Unable to start Google OAuth flow" },
      { status: 500 },
    );
  }
}

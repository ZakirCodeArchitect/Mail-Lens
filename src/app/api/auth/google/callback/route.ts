import { NextRequest, NextResponse } from "next/server";

import { getGmailProfile, getTokensFromCode } from "@/lib/google";
import { prisma } from "@/lib/prisma";

function toDashboardUrl(
  request: NextRequest,
  status: "connected" | "error",
  reason?: string,
  userId?: string,
) {
  const appUrl = process.env.APP_URL || request.nextUrl.origin;
  const url = new URL("/dashboard", appUrl);
  url.searchParams.set("gmail", status);

  if (reason) {
    url.searchParams.set("reason", reason);
  }

  if (userId) {
    url.searchParams.set("userId", userId);
  }

  return url;
}

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    const oauthError = request.nextUrl.searchParams.get("error");

    if (oauthError) {
      return NextResponse.redirect(
        toDashboardUrl(request, "error", "google_oauth_denied").toString(),
      );
    }

    if (!code) {
      return NextResponse.redirect(
        toDashboardUrl(request, "error", "missing_code").toString(),
      );
    }

    const tokens = await getTokensFromCode(code);
    const profile = await getGmailProfile(tokens.accessToken);

    const user = await prisma.user.upsert({
      where: { email: profile.email },
      create: {
        email: profile.email,
      },
      update: {
        email: profile.email,
      },
    });

    await prisma.googleAccount.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        googleEmail: profile.email,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiryDate: tokens.expiryDate,
        scope: tokens.scope,
      },
      update: {
        googleEmail: profile.email,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiryDate: tokens.expiryDate,
        scope: tokens.scope,
      },
    });

    return NextResponse.redirect(toDashboardUrl(request, "connected", undefined, user.id).toString());
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return NextResponse.redirect(
      toDashboardUrl(request, "error", "oauth_callback_failed").toString(),
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.json({ error: error || "No authorization code received" }, { status: 400 });
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return NextResponse.json({ error: `Token exchange failed: ${err}` }, { status: 500 });
  }

  const tokens = await tokenRes.json();

  if (!tokens.refresh_token) {
    return NextResponse.json(
      { error: "No refresh token received. Revoke app access at myaccount.google.com/permissions and try again." },
      { status: 400 }
    );
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await prisma.gscToken.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      expiresAt,
    },
    update: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      expiresAt,
    },
  });

  console.log("[GSC] OAuth tokens stored, expires:", expiresAt.toISOString());

  // Redirect back to clients page
  const baseUrl = req.nextUrl.origin;
  return NextResponse.redirect(`${baseUrl}/clients?gsc=connected`);
}

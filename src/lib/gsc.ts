import { prisma, pgPool } from "./prisma";
import { encrypt, decrypt } from "./crypto";

const GSC_BASE = "https://www.googleapis.com/webmasters/v3";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// --- Token Management ---

async function getValidAccessToken(): Promise<string> {
  const token = await prisma.gscToken.findUnique({ where: { id: "singleton" } });
  if (!token) throw new Error("GSC not connected. Visit /api/gsc/auth to connect.");

  // If token is still fresh (> 60s remaining), return it
  if (token.expiresAt.getTime() > Date.now() + 60_000) {
    return decrypt(token.accessToken);
  }

  // Token expired or about to expire - refresh with advisory lock
  const client = await pgPool.connect();
  try {
    // Acquire advisory lock to prevent concurrent refresh
    await client.query("SELECT pg_advisory_lock(hashtext('gsc_token_refresh'))");

    // Re-check after acquiring lock (another request may have refreshed)
    const freshToken = await prisma.gscToken.findUnique({ where: { id: "singleton" } });
    if (freshToken && freshToken.expiresAt.getTime() > Date.now() + 60_000) {
      return decrypt(freshToken.accessToken);
    }

    // Refresh the token
    const refreshToken = decrypt(token.refreshToken);
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Token refresh failed: ${err}`);
    }

    const data = await res.json();
    const newAccessToken = data.access_token as string;
    const expiresAt = new Date(Date.now() + (data.expires_in as number) * 1000);

    // Google may issue a new refresh token on refresh
    const newRefreshToken = (data.refresh_token as string) || refreshToken;

    await prisma.gscToken.update({
      where: { id: "singleton" },
      data: {
        accessToken: encrypt(newAccessToken),
        refreshToken: encrypt(newRefreshToken),
        expiresAt,
      },
    });

    console.log("[GSC] Token refreshed, expires:", expiresAt.toISOString());
    return newAccessToken;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('gsc_token_refresh'))");
    client.release();
  }
}

// --- Authenticated Fetch ---

async function gscFetch(url: string, init?: RequestInit): Promise<Response> {
  const accessToken = await getValidAccessToken();

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  // Handle expired token (401) - refresh and retry once
  if (res.status === 401) {
    console.log("[GSC] Got 401, forcing token refresh...");
    // Invalidate cached token by setting expiresAt to past
    await prisma.gscToken.update({
      where: { id: "singleton" },
      data: { expiresAt: new Date(0) },
    });
    const freshToken = await getValidAccessToken();
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${freshToken}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  }

  // Handle rate limit (429)
  if (res.status === 429) {
    console.log("[GSC] Rate limited, waiting 60s...");
    await new Promise((r) => setTimeout(r, 60_000));
    return gscFetch(url, init);
  }

  return res;
}

// --- Public API Functions ---

export interface GscSiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

export async function listProperties(): Promise<GscSiteEntry[]> {
  const res = await gscFetch(`${GSC_BASE}/sites`);
  if (!res.ok) {
    throw new Error(`GSC listProperties failed ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.siteEntry || []) as GscSiteEntry[];
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function fetchSearchAnalytics(params: {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit?: number;
  startRow?: number;
}): Promise<SearchAnalyticsRow[]> {
  const encodedSiteUrl = encodeURIComponent(params.siteUrl);
  const res = await gscFetch(
    `${GSC_BASE}/sites/${encodedSiteUrl}/searchAnalytics/query`,
    {
      method: "POST",
      body: JSON.stringify({
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions: params.dimensions,
        rowLimit: params.rowLimit || 25000,
        startRow: params.startRow || 0,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`GSC searchAnalytics failed ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return (data.rows || []) as SearchAnalyticsRow[];
}

export async function fetchAllSearchAnalytics(params: {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
}): Promise<SearchAnalyticsRow[]> {
  const allRows: SearchAnalyticsRow[] = [];
  let startRow = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await fetchSearchAnalytics({ ...params, startRow, rowLimit: 25000 });
    allRows.push(...rows);

    if (rows.length < 25000) break; // Last page
    startRow += 25000;

    console.log(`[GSC] Fetched ${allRows.length} rows so far, paginating...`);
  }

  return allRows;
}

// --- Helper: check if GSC is connected ---

export async function isConnected(): Promise<boolean> {
  const token = await prisma.gscToken.findUnique({ where: { id: "singleton" } });
  return !!token;
}

// --- Helper: date formatting ---

export function gscEndDate(): string {
  // GSC data has 3-day lag
  const d = new Date();
  d.setDate(d.getDate() - 3);
  return d.toISOString().split("T")[0];
}

export function gscStartDate(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().split("T")[0];
}

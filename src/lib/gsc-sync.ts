import { prisma } from "./prisma";
import { listProperties, fetchAllSearchAnalytics, gscEndDate, gscStartDate } from "./gsc";

// URL patterns to filter out at ingest
const SKIP_URL_PATTERNS = [
  /#/, // Fragment/anchor URLs (sitelinks)
  /\/page\/\d+/, // Pagination: /page/2/
  /[?&]page=\d+/, // Pagination: ?page=2
  /[?&]p=\d+/, // Pagination: ?p=2
];

function shouldSkipUrl(url: string): boolean {
  // Skip fragment URLs
  if (SKIP_URL_PATTERNS.some((p) => p.test(url))) return true;

  // Skip faceted navigation (3+ query params)
  try {
    const u = new URL(url);
    if (u.searchParams.size >= 3) return true;
  } catch {
    // Invalid URL, skip it
    return true;
  }

  return false;
}

function matchPropertyToClient(domain: string, properties: { siteUrl: string }[]): string | null {
  // Clean the client domain for matching
  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").toLowerCase();

  for (const prop of properties) {
    const propClean = prop.siteUrl
      .replace(/^sc-domain:/, "")
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "")
      .toLowerCase();

    if (propClean === clean || propClean.includes(clean) || clean.includes(propClean)) {
      return prop.siteUrl;
    }
  }
  return null;
}

export async function syncGscProperty(clientId: string): Promise<{
  pagesUpserted: number;
  queriesUpserted: number;
  queriesFiltered: number;
}> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { gscProperty: true },
  });

  if (!client) throw new Error("Client not found");

  let property = client.gscProperty;

  // Auto-create GscProperty if none exists
  if (!property) {
    const properties = await listProperties();
    const matchedSiteUrl = matchPropertyToClient(client.domain, properties);

    if (!matchedSiteUrl) {
      throw new Error(
        `No GSC property found matching "${client.domain}". Available: ${properties.map((p) => p.siteUrl).join(", ") || "none"}`
      );
    }

    property = await prisma.gscProperty.create({
      data: {
        clientId,
        siteUrl: matchedSiteUrl,
        syncStatus: "syncing",
      },
    });

    console.log(`[GSC Sync] Auto-linked property "${matchedSiteUrl}" to client "${client.name}"`);
  } else {
    await prisma.gscProperty.update({
      where: { id: property.id },
      data: { syncStatus: "syncing", syncError: null },
    });
  }

  const propertyId = property.id;
  const siteUrl = property.siteUrl;

  try {
    // Calculate date range
    const endDate = gscEndDate();
    let startDate: string;

    if (property.lastSyncAt) {
      // Delta sync: from lastSync - 3 days (GSC reprocessing lag)
      const delta = new Date(property.lastSyncAt);
      delta.setDate(delta.getDate() - 3);
      startDate = delta.toISOString().split("T")[0];
    } else {
      // Initial backfill: 90 days
      startDate = gscStartDate(93); // 90 + 3 day lag
    }

    console.log(`[GSC Sync] "${client.name}" (${siteUrl}): ${startDate} to ${endDate}`);

    // 1. Fetch page-level data
    const pageRows = await fetchAllSearchAnalytics({
      siteUrl,
      startDate,
      endDate,
      dimensions: ["page"],
    });

    let pagesUpserted = 0;
    for (const row of pageRows) {
      const url = row.keys[0];
      if (shouldSkipUrl(url)) continue;

      await prisma.gscPage.upsert({
        where: { propertyId_url: { propertyId, url } },
        create: {
          propertyId,
          url,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          avgPosition: row.position,
          lastSyncDate: endDate,
        },
        update: {
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          avgPosition: row.position,
          lastSyncDate: endDate,
        },
      });
      pagesUpserted++;
    }

    console.log(`[GSC Sync] ${pagesUpserted} pages upserted (${pageRows.length - pagesUpserted} filtered)`);

    // 2. Fetch query+page data
    const queryRows = await fetchAllSearchAnalytics({
      siteUrl,
      startDate,
      endDate,
      dimensions: ["query", "page"],
    });

    let queriesUpserted = 0;
    let queriesFiltered = 0;

    for (const row of queryRows) {
      const query = row.keys[0];
      const page = row.keys[1];

      // Filter: skip empty queries (anonymized), low impressions, bad URLs
      if (!query || query.trim() === "") { queriesFiltered++; continue; }
      if (row.impressions < 50) { queriesFiltered++; continue; }
      if (shouldSkipUrl(page)) { queriesFiltered++; continue; }

      await prisma.gscQuery.upsert({
        where: { propertyId_query_page: { propertyId, query, page } },
        create: {
          propertyId,
          query,
          page,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          avgPosition: row.position,
          lastSyncDate: endDate,
        },
        update: {
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          avgPosition: row.position,
          lastSyncDate: endDate,
        },
      });
      queriesUpserted++;
    }

    console.log(`[GSC Sync] ${queriesUpserted} queries upserted, ${queriesFiltered} filtered (of ${queryRows.length} total)`);

    // Update property
    await prisma.gscProperty.update({
      where: { id: propertyId },
      data: { lastSyncAt: new Date(), syncStatus: "idle", syncError: null },
    });

    return { pagesUpserted, queriesUpserted, queriesFiltered };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Unknown error";
    await prisma.gscProperty.update({
      where: { id: propertyId },
      data: { syncStatus: "failed", syncError: errMsg },
    });
    console.error(`[GSC Sync] Failed for "${client.name}":`, errMsg);
    throw e;
  }
}

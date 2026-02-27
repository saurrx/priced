import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const JUP_API = "https://api.jup.ag/prediction/v1";
const JUP_API_KEY = process.env.JUP_API_KEY || "5f6da690-eb02-4aed-858b-3c034f0b490d";
const VOLUME_THRESHOLD = 10_000; // $10K volume (Jupiter volume is in micro-USD / 1e6)
const PAGE_SIZE = 20; // Jupiter max per page
const CONCURRENCY = 5; // Parallel page fetches
const MAX_ZERO_PAGES = 3; // Stop after N consecutive pages with no qualifying markets

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "server", "data");
const SNAPSHOT_PATH = join(DATA_DIR, "markets-snapshot.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JupMarket {
    marketId: string;
    status: string;
    result: string | null;
    openTime: number;
    closeTime: number;
    resolveAt: number | null;
    metadata: {
        title: string;
        closeTime: number;
        openTime: number;
        isTeamMarket: boolean;
        rulesPrimary: string;
        rulesSecondary: string;
        status: string;
    };
    pricing: {
        buyYesPriceUsd: number;
        sellYesPriceUsd: number;
        sellNoPriceUsd: number;
        buyNoPriceUsd: number;
        volume: number;
    };
}

interface JupEvent {
    eventId: string;
    isActive: boolean;
    isLive: boolean;
    category: string;
    subcategory: string;
    isTrending: boolean;
    metadata: {
        slug: string;
        title: string;
        series: string;
        eventId: string;
        imageUrl: string;
        subtitle: string;
        closeTime: string;
    };
    markets: JupMarket[];
}

interface FlatMarket {
    marketId: string;
    eventId: string;
    title: string;
    eventTitle: string;
    eventSubtitle: string;
    category: string;
    subcategory: string;
    imageUrl: string;
    buyYesPriceUsd: number;
    sellYesPriceUsd: number;
    buyNoPriceUsd: number;
    sellNoPriceUsd: number;
    volume: number;
    closeTime: number;
    openTime: number;
    rulesPrimary: string;
    status: string;
    isTrending: boolean;
}

interface EventEntry {
    title: string;
    subtitle: string;
    category: string;
    subcategory: string;
    imageUrl: string;
    markets: string[];
}

interface Snapshot {
    meta: {
        snapshotDate: string;
        version: number;
        source: string;
        totalEventsScanned: number;
        totalMarketsScanned: number;
        filteredMarkets: number;
        filteredEvents: number;
        volumeThreshold: number;
        categories: Record<string, number>;
        ingestionTimeMs: number;
    };
    events: Record<string, EventEntry>;
    markets: Record<string, FlatMarket>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
    console.log(`[INGEST] ${msg}`);
}

function warn(msg: string) {
    console.warn(`[INGEST] WARN: ${msg}`);
}

async function fetchJup(path: string): Promise<any> {
    const url = `${JUP_API}${path}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, {
                headers: { "x-api-key": JUP_API_KEY },
            });
            if (res.status === 429) {
                const wait = Math.pow(2, attempt) * 1000;
                log(`Rate limited, waiting ${wait / 1000}s...`);
                await new Promise((r) => setTimeout(r, wait));
                continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
            return await res.json();
        } catch (err: any) {
            if (attempt === 3) throw err;
            await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
    }
}

// ---------------------------------------------------------------------------
// Step 1: Fetch events sorted by volume (with early termination)
// ---------------------------------------------------------------------------

async function fetchAllEvents(): Promise<{
    events: JupEvent[];
    totalScanned: number;
}> {
    log("Step 1: Fetching Jupiter events (sorted by volume desc)...");
    const t0 = Date.now();

    // First, get total count
    const first = await fetchJup(
        `/events?includeMarkets=true&sortBy=volume&sortDirection=desc&start=0&end=${PAGE_SIZE}`
    );
    const total = first.pagination?.total || 0;
    log(`  Total events available: ${total.toLocaleString()}`);

    const allEvents: JupEvent[] = [...(first.data || [])];
    let consecutiveZeroPages = 0;
    let pagesProcessed = 1;

    // Check first page
    const firstPageQualifying = countQualifyingMarkets(allEvents);
    if (firstPageQualifying === 0) consecutiveZeroPages++;

    // Fetch remaining pages with concurrency
    let start = PAGE_SIZE;
    while (start < total && consecutiveZeroPages < MAX_ZERO_PAGES) {
        // Build batch of page requests
        const batch: number[] = [];
        for (let i = 0; i < CONCURRENCY && start + i * PAGE_SIZE < total; i++) {
            batch.push(start + i * PAGE_SIZE);
        }

        const results = await Promise.all(
            batch.map((s) =>
                fetchJup(
                    `/events?includeMarkets=true&sortBy=volume&sortDirection=desc&start=${s}&end=${s + PAGE_SIZE}`
                )
            )
        );

        for (const result of results) {
            const events: JupEvent[] = result.data || [];
            allEvents.push(...events);
            pagesProcessed++;

            const qualifying = countQualifyingMarkets(events);
            if (qualifying === 0) {
                consecutiveZeroPages++;
            } else {
                consecutiveZeroPages = 0;
            }
        }

        start += batch.length * PAGE_SIZE;

        if (pagesProcessed % 10 === 0) {
            log(
                `  ${allEvents.length.toLocaleString()} events fetched (${pagesProcessed} pages) [${((Date.now() - t0) / 1000).toFixed(1)}s]`
            );
        }
    }

    if (consecutiveZeroPages >= MAX_ZERO_PAGES) {
        log(
            `  Early stop: ${MAX_ZERO_PAGES} consecutive pages with no markets above $${(VOLUME_THRESHOLD / 1000).toFixed(0)}K volume`
        );
    }

    log(
        `Step 1 complete: ${allEvents.length.toLocaleString()} events in ${pagesProcessed} pages [${((Date.now() - t0) / 1000).toFixed(1)}s]`
    );
    return { events: allEvents, totalScanned: allEvents.length };
}

function countQualifyingMarkets(events: JupEvent[]): number {
    let count = 0;
    for (const e of events) {
        for (const m of e.markets || []) {
            if (
                m.status === "open" &&
                m.pricing &&
                m.pricing.volume >= VOLUME_THRESHOLD
            ) {
                count++;
            }
        }
    }
    return count;
}

// ---------------------------------------------------------------------------
// Step 2: Filter & flatten
// ---------------------------------------------------------------------------

function filterAndFlatten(events: JupEvent[]): {
    flatMarkets: FlatMarket[];
    eventMap: Record<string, EventEntry>;
    totalMarketsScanned: number;
} {
    log("Step 2: Filtering and flattening...");

    const flatMarkets: FlatMarket[] = [];
    const eventMap: Record<string, EventEntry> = {};
    let totalMarketsScanned = 0;
    let afterStatus = 0;
    let afterVolume = 0;

    for (const event of events) {
        for (const m of event.markets || []) {
            totalMarketsScanned++;

            if (m.status !== "open") continue;
            afterStatus++;

            if (!m.pricing || m.pricing.volume < VOLUME_THRESHOLD) continue;
            afterVolume++;

            flatMarkets.push({
                marketId: m.marketId,
                eventId: event.eventId,
                title: m.metadata?.title || "",
                eventTitle: event.metadata?.title || "",
                eventSubtitle: event.metadata?.subtitle || "",
                category: event.category || "unknown",
                subcategory: event.subcategory || "",
                imageUrl: event.metadata?.imageUrl || "",
                buyYesPriceUsd: m.pricing.buyYesPriceUsd,
                sellYesPriceUsd: m.pricing.sellYesPriceUsd,
                buyNoPriceUsd: m.pricing.buyNoPriceUsd,
                sellNoPriceUsd: m.pricing.sellNoPriceUsd,
                volume: m.pricing.volume,
                closeTime: m.closeTime,
                openTime: m.openTime,
                rulesPrimary: m.metadata?.rulesPrimary || "",
                status: m.status,
                isTrending: event.isTrending ?? false,
            });

            // Build event map
            if (!eventMap[event.eventId]) {
                eventMap[event.eventId] = {
                    title: event.metadata?.title || "",
                    subtitle: event.metadata?.subtitle || "",
                    category: event.category || "unknown",
                    subcategory: event.subcategory || "",
                    imageUrl: event.metadata?.imageUrl || "",
                    markets: [],
                };
            }
            eventMap[event.eventId].markets.push(m.marketId);
        }
    }

    log(`  Raw markets scanned: ${totalMarketsScanned.toLocaleString()}`);
    log(`  After status=open: ${afterStatus.toLocaleString()}`);
    log(
        `  After volume >= $${(VOLUME_THRESHOLD / 1000).toFixed(0)}K: ${afterVolume.toLocaleString()}`
    );
    log(
        `Step 2 complete: ${flatMarkets.length.toLocaleString()} markets across ${Object.keys(eventMap).length.toLocaleString()} events`
    );

    return { flatMarkets, eventMap, totalMarketsScanned };
}

// ---------------------------------------------------------------------------
// Step 3: Save snapshot + generate embedding texts
// ---------------------------------------------------------------------------

function saveSnapshot(
    flatMarkets: FlatMarket[],
    eventMap: Record<string, EventEntry>,
    totalEventsScanned: number,
    totalMarketsScanned: number,
    ingestionTimeMs: number
): void {
    log("Step 3: Saving snapshot...");

    // Category distribution
    const categories: Record<string, number> = {};
    for (const m of flatMarkets) {
        categories[m.category] = (categories[m.category] || 0) + 1;
    }
    const sortedCategories = Object.fromEntries(
        Object.entries(categories).sort(([, a], [, b]) => b - a)
    );

    // Build markets dict
    const marketsDict: Record<string, FlatMarket> = {};
    for (const m of flatMarkets) {
        marketsDict[m.marketId] = m;
    }

    const snapshot: Snapshot = {
        meta: {
            snapshotDate: new Date().toISOString(),
            version: 3,
            source: "jupiter",
            totalEventsScanned,
            totalMarketsScanned,
            filteredMarkets: flatMarkets.length,
            filteredEvents: Object.keys(eventMap).length,
            volumeThreshold: VOLUME_THRESHOLD,
            categories: sortedCategories,
            ingestionTimeMs,
        },
        events: eventMap,
        markets: marketsDict,
    };

    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));

    const fileSizeMB = (
        Buffer.byteLength(JSON.stringify(snapshot)) /
        (1024 * 1024)
    ).toFixed(1);
    log(`  Snapshot: ${SNAPSHOT_PATH} (${fileSizeMB} MB)`);

    // Generate event tickers (eventId list for embedding index)
    const eventIds = Object.keys(eventMap);
    const eventTickersPath = join(DATA_DIR, "event-tickers.json");
    writeFileSync(eventTickersPath, JSON.stringify(eventIds, null, 2));
    log(`  Event IDs: ${eventTickersPath} (${eventIds.length} events)`);

    // Generate embedding input texts (one per event: eventTitle)
    const embeddingTexts: string[] = eventIds.map((id) => {
        const event = eventMap[id];
        // Combine event title + market titles for richer embeddings
        const marketTitles = event.markets
            .map((mId) => marketsDict[mId]?.title || "")
            .filter(Boolean)
            .slice(0, 5) // Top 5 markets to keep text manageable
            .join(", ");
        return `${event.title}. ${marketTitles}`.trim();
    });
    const embeddingTextsPath = join(DATA_DIR, "embedding-texts.json");
    writeFileSync(embeddingTextsPath, JSON.stringify(embeddingTexts, null, 2));
    log(`  Embedding texts: ${embeddingTextsPath} (${embeddingTexts.length} texts)`);

    log("Step 3 complete");
}

// ---------------------------------------------------------------------------
// Step 4: Summary
// ---------------------------------------------------------------------------

function printSummary(
    flatMarkets: FlatMarket[],
    eventMap: Record<string, EventEntry>,
    ingestionTimeMs: number
): void {
    const categories: Record<string, number> = {};
    for (const m of flatMarkets) {
        categories[m.category] = (categories[m.category] || 0) + 1;
    }
    const sortedCats = Object.entries(categories).sort(([, a], [, b]) => b - a);

    const topByVolume = flatMarkets.reduce(
        (top, m) => (m.volume > top.volume ? m : top),
        flatMarkets[0]
    );

    const w = 58;
    const line = (s: string) => console.log(s);
    const pad = (s: string) => s.padEnd(w - 1) + "\u2551";

    line("");
    line("\u2554" + "\u2550".repeat(w) + "\u2557");
    line("\u2551" + pad("  JUPITER INGESTION COMPLETE — v3"));
    line("\u2560" + "\u2550".repeat(w) + "\u2563");
    line(
        "\u2551" +
        pad(
            `  Markets:   ${flatMarkets.length.toLocaleString().padStart(6)}  (vol >= $${(VOLUME_THRESHOLD / 1000).toFixed(0)}K)`
        )
    );
    line(
        "\u2551" +
        pad(
            `  Events:    ${Object.keys(eventMap).length.toString().padStart(6)}`
        )
    );
    line(
        "\u2551" +
        pad(`  Duration:  ${(ingestionTimeMs / 1000).toFixed(1).padStart(6)}s`)
    );
    line("\u2560" + "\u2550".repeat(w) + "\u2563");
    line("\u2551" + pad("  CATEGORIES"));
    for (const [cat, count] of sortedCats) {
        const pct = ((count / flatMarkets.length) * 100).toFixed(1);
        line(
            "\u2551" +
            pad(
                `  ${cat.padEnd(20)} ${count.toString().padStart(5)}  (${pct.padStart(5)}%)`
            )
        );
    }
    line("\u255A" + "\u2550".repeat(w) + "\u255D");
    line("");
    line(
        `[TOP] ${topByVolume.eventTitle}: "${topByVolume.title}" vol=$${(topByVolume.volume / 1_000_000).toFixed(1)}M`
    );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const t0 = Date.now();
    console.log("=".repeat(60));
    log("Jupiter Market Ingestion v3 — Starting");
    console.log("=".repeat(60));

    // Step 1: Fetch
    const { events, totalScanned } = await fetchAllEvents();

    // Step 2: Filter
    const { flatMarkets, eventMap, totalMarketsScanned } =
        filterAndFlatten(events);

    if (flatMarkets.length === 0) {
        log("No markets passed filters. Nothing to save.");
        return;
    }

    // Step 3: Save
    const ingestionTimeMs = Date.now() - t0;
    saveSnapshot(
        flatMarkets,
        eventMap,
        totalScanned,
        totalMarketsScanned,
        ingestionTimeMs
    );

    // Summary
    printSummary(flatMarkets, eventMap, ingestionTimeMs);

    console.log("=".repeat(60));
    log(
        `TOTAL: ${flatMarkets.length.toLocaleString()} markets ingested in ${(ingestionTimeMs / 1000).toFixed(1)}s`
    );
    console.log("=".repeat(60));

    log("");
    log("Next: Run embedding generation:");
    log("  cd server && python3 generate_embeddings.py");
}

main().catch((err) => {
    console.error("[INGEST] Fatal error:", err);
    process.exit(1);
});

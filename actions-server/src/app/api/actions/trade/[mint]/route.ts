import {
  ACTIONS_CORS_HEADERS,
  ActionGetResponse,
  ActionPostRequest,
  BLOCKCHAIN_IDS,
} from "@solana/actions";

const headers = {
  ...ACTIONS_CORS_HEADERS,
  "x-blockchain-ids": BLOCKCHAIN_IDS.mainnet,
  "x-action-version": "2.4",
};

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const DFLOW_API = "https://quote-api.dflow.net";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const OPTIONS = async () => new Response(null, { headers });

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ mint: string }> }
) => {
  const { mint } = await params;

  // Look up market info from our backend
  const marketRes = await fetch(`${BACKEND_URL}/market/${mint}`);
  if (!marketRes.ok) {
    return Response.json({ error: "Market not found" }, { status: 404, headers });
  }
  const market = await marketRes.json();
  if (market.error) {
    return Response.json({ error: "Market not found" }, { status: 404, headers });
  }

  const side = market.side as string; // "YES" or "NO"
  const price = side === "YES" ? market.yesAsk : market.noBid;
  const priceDisplay = price != null ? `${price}\u00A2` : "";

  const baseHref = `/api/actions/trade/${mint}`;

  const response: ActionGetResponse = {
    type: "action",
    icon: `${new URL(req.url).origin}/icon.png`,
    title: `Buy ${side}: ${market.title}`,
    description: `${market.eventTitle ?? market.title} — currently ${priceDisplay}. Powered by Kalshi \u00D7 DFlow on Solana.`,
    label: `Buy ${side}`,
    links: {
      actions: [
        { type: "transaction", label: "$1", href: `${baseHref}?amount=1000000` },
        { type: "transaction", label: "$5", href: `${baseHref}?amount=5000000` },
        { type: "transaction", label: "$10", href: `${baseHref}?amount=10000000` },
        {
          type: "transaction",
          label: "Custom",
          href: `${baseHref}?amount={amount}`,
          parameters: [
            { name: "amount", label: "Amount in USDC (e.g. 5)", type: "number" },
          ],
        },
      ],
    },
  };

  return Response.json(response, { status: 200, headers });
};

export const POST = async (
  req: Request,
  { params }: { params: Promise<{ mint: string }> }
) => {
  try {
    const { mint } = await params;
    const url = new URL(req.url);
    let amount = url.searchParams.get("amount");

    // If amount looks like raw USDC (user typed "5"), convert to micro-units
    const amountNum = Number(amount);
    if (amountNum > 0 && amountNum < 1000) {
      // User typed dollar amount, convert: $5 → 5_000_000 (USDC has 6 decimals)
      amount = String(Math.round(amountNum * 1_000_000));
    }

    const body: ActionPostRequest = await req.json();
    const userPublicKey = body.account;

    // Call DFlow Trade API
    const tradeParams = new URLSearchParams({
      inputMint: USDC_MINT,
      outputMint: mint,
      amount: amount!,
      slippageBps: "100",
      userPublicKey,
    });

    const tradeHeaders: HeadersInit = {};
    if (process.env.DFLOW_API_KEY) {
      tradeHeaders["x-api-key"] = process.env.DFLOW_API_KEY;
    }

    const tradeRes = await fetch(
      `${DFLOW_API}/order?${tradeParams.toString()}`,
      { headers: tradeHeaders }
    );

    if (!tradeRes.ok) {
      const err = await tradeRes.text();
      console.error("DFlow API error:", err);
      return Response.json(
        { error: `Trade failed: ${tradeRes.status}` },
        { status: 400, headers }
      );
    }

    const tradeData = await tradeRes.json();

    // DFlow returns the transaction as base64 — pass through directly
    const response = {
      type: "transaction",
      transaction: tradeData.openTransaction ?? tradeData.transaction,
      message: tradeData.executionMode === "async"
        ? "Order submitted. Tokens will arrive shortly (async fill)."
        : undefined,
    };

    return Response.json(response, { status: 200, headers });
  } catch (error) {
    console.error("POST error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
};

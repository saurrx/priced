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
const JUP_API = "https://api.jup.ag/prediction/v1";
const JUP_API_KEY = process.env.JUP_API_KEY || "";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const OPTIONS = async () => new Response(null, { headers });

export const GET = async (
    req: Request,
    { params }: { params: Promise<{ marketId: string }> }
) => {
    const { marketId } = await params;

    // Look up market info from our backend
    const marketRes = await fetch(`${BACKEND_URL}/market/${marketId}`);
    if (!marketRes.ok) {
        return Response.json({ message: "Market not found" }, { status: 404, headers });
    }
    const market = await marketRes.json();
    if (market.error) {
        return Response.json({ message: "Market not found" }, { status: 404, headers });
    }

    // Jupiter prices are in micro-USD (1,000,000 = $1.00)
    const yesPrice = market.buyYesPriceUsd;
    const noPrice = market.buyNoPriceUsd;
    const yesCents = yesPrice != null ? (yesPrice / 10000).toFixed(0) : "?";
    const noCents = noPrice != null ? (noPrice / 10000).toFixed(0) : "?";

    const baseHref = `/api/actions/trade/${marketId}`;
    const iconUrl = market.imageUrl || `https://${req.headers.get("host") || new URL(req.url).host}/icon.png`;

    const response: ActionGetResponse = {
        type: "action",
        icon: iconUrl,
        title: `${market.eventTitle}`,
        description: `${market.title} — YES ${yesCents}¢ / NO ${noCents}¢. \nPowered by @seerumAI.`,
        label: "Trade",
        links: {
            actions: [
                { type: "transaction", label: `Buy YES ${yesCents}¢ — 2 USDC`, href: `${baseHref}?amount=2000000&side=yes` },
                { type: "transaction", label: `Buy NO ${noCents}¢ — 2 USDC`, href: `${baseHref}?amount=2000000&side=no` },
                {
                    type: "transaction",
                    label: "Buy YES",
                    href: `${baseHref}?amountUsd={amount}&side=yes`,
                    parameters: [
                        {
                            name: "amount",
                            label: "Enter amount in USDC",
                            required: true,
                        }
                    ]
                },
                {
                    type: "transaction",
                    label: "Buy NO",
                    href: `${baseHref}?amountUsd={amount}&side=no`,
                    parameters: [
                        {
                            name: "amount",
                            label: "Enter amount in USDC",
                            required: true,
                        }
                    ]
                },
            ],
        },
    };

    return Response.json(response, { status: 200, headers });
};

export const POST = async (
    req: Request,
    { params }: { params: Promise<{ marketId: string }> }
) => {
    try {
        const { marketId } = await params;
        const url = new URL(req.url);
        let amount = url.searchParams.get("amount");
        const side = url.searchParams.get("side") || "yes";

        let amountUsd = url.searchParams.get("amountUsd");

        // Convert raw USD input to micro-units
        if (amountUsd) {
            const usdNum = Number(amountUsd);
            if (isNaN(usdNum) || usdNum <= 0) {
                return Response.json({ message: "Invalid amount" }, { status: 400, headers });
            }
            amount = String(Math.round(usdNum * 1_000_000));
        }

        const body: ActionPostRequest = await req.json();
        const userPublicKey = body.account;

        // Call Jupiter Prediction Market API
        const orderRes = await fetch(`${JUP_API}/orders`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": JUP_API_KEY,
            },
            body: JSON.stringify({
                ownerPubkey: userPublicKey,
                marketId: marketId,
                isYes: side === "yes",
                isBuy: true,
                depositAmount: amount,
                depositMint: USDC_MINT,
            }),
        });

        if (!orderRes.ok) {
            const err = await orderRes.text();
            console.error("Jupiter API error:", err);
            return Response.json(
                { message: `Order failed: ${orderRes.status} — ${err}` },
                { status: 400, headers }
            );
        }

        const orderData = await orderRes.json();

        // Jupiter returns base64 transaction — pass through to blink
        const response = {
            transaction: orderData.transaction,
            message: "Order placed! Jupiter keepers will fill your position shortly.",
        };

        return Response.json(response, { status: 200, headers });
    } catch (error) {
        console.error("POST error:", error);
        return Response.json(
            { message: "Internal server error" },
            { status: 500, headers }
        );
    }
};

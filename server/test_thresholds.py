"""Threshold tuning test suite for tweet-to-market matching.

Tests should-match tweets (expecting a specific event match) and
should-not-match tweets (expecting no match / None).
"""

import json
import time
import numpy as np
from embedder import Embedder
from matcher import Matcher
from reranker import Reranker

# -- Should-match tweets: (tweet_text, list of acceptable event substrings) --
# Multiple acceptable substrings allow for matching to related events on the same topic
SHOULD_MATCH = [
    # Iran / geopolitics — NOTE: most Iran strike markets are resolved ($1.00 price)
    # so these may legitimately return no match when markets are stale
    ("BREAKING: US military strikes multiple targets in Iran overnight, Pentagon confirms",
     ["strikes Iran", "strike Iran", "Iran"]),
    ("Iran's Khamenei reportedly in poor health, succession crisis looms",
     ["Khamenei"]),
    ("Israel launches retaliatory strikes on Iranian nuclear facilities",
     ["Israel strikes Iran", "strikes Iran", "Iran"]),
    ("Russia and Ukraine agree to 30-day ceasefire starting next week",
     ["Ukraine ceasefire"]),
    ("Trump says he will meet Putin in Geneva next month to discuss peace deal",
     ["Trump meet with Putin", "Putin"]),
    ("Will the US actually invade Venezuela? Maduro is getting more aggressive",
     ["invade Venezuela", "Venezuela"]),

    # US politics
    ("Who's going to be the Democratic nominee in 2028? My money is on Newsom",
     ["Democratic Presidential Nominee 2028", "Democratic"]),
    ("Trump considering replacing Fed Chair - Kevin Warsh is the frontrunner",
     ["Trump nominate as Fed Chair", "Fed Chair"]),
    ("JD Vance is already positioning himself for 2028 presidential run",
     ["Presidential Election", "Vance"]),
    ("Fed expected to hold rates steady at March meeting, no cut likely",
     ["Fed decision in March", "Fed rate cut", "Fed rate"]),
    ("How many rate cuts will we actually get this year? Market pricing in 2",
     ["Fed rate cuts in 2026", "rate cut"]),

    # Crypto prices
    ("Bitcoin just dropped below $80K, are we heading to $75K?",
     ["Bitcoin hit", "Bitcoin"]),
    ("ETH looking weak, could see $1600 before any bounce",
     ["Ethereum hit", "Ethereum"]),
    ("Solana pumping hard today, can it break $170?",
     ["Solana hit", "Solana"]),
    ("XRP holding strong above $2, next target $2.40",
     ["XRP hit", "XRP above"]),

    # Crypto / tech
    ("MicroStrategy buying more Bitcoin. When will Saylor finally sell?",
     ["MicroStrategy"]),
    ("OpenSea token launch rumored for next month, what FDV are we expecting?",
     ["Opensea", "OpenSea"]),
    ("MetaMask finally launching their token? About time!",
     ["MetaMask launch a token", "MetaMask"]),
    ("GTA 6 delayed again? I thought it was coming this spring",
     ["GTA VI", "GTA 6"]),
    ("MegaETH launch is going to be huge, calling $2B FDV day one",
     ["MegaETH market cap", "MegaETH"]),

    # Sports / entertainment
    ("Arsenal looking strong in Champions League this year, could they win it?",
     ["Champions League", "Arsenal"]),
    ("Best Picture predictions: Sinners is the frontrunner for Oscars 2026",
     ["Best Picture Winner", "Oscars"]),

    # Gold / commodities
    ("Gold hitting new all time highs, $5500 is next",
     ["Gold"]),

    # Other specific
    ("Epstein client list - when is it actually getting released?",
     ["Epstein client list"]),
]

# -- Should-NOT-match tweets --
SHOULD_NOT_MATCH = [
    "Just had the best coffee this morning, great start to the day",
    "My cat knocked over my monitor again, working from home is chaos",
    "New Taylor Swift album dropping next month, so excited!",
    "Anyone else think the new iPhone design is ugly?",
    "Just finished a 10K run, personal best time!",
    "The sunset tonight is absolutely gorgeous",
    "Crypto is the future of finance, everyone should learn about it",
    "I love prediction markets, they're so much fun to trade",
    "Stick to crypto instead of political news, way more interesting",
    "This bull market is insane, everything is pumping",
    "AI is going to change the world, bullish on tech stocks in general",
    "Web3 gaming is finally getting good, played some amazing titles this week",
    "Just deployed my first smart contract on Ethereum, feeling accomplished",
    "The meme coin season is back, degen szn in full effect",
    "Blockchain technology will revolutionize supply chain management",
]

def run_tests():
    print("Loading models...")
    embedder = Embedder()

    try:
        reranker = Reranker()
        print("Reranker loaded")
    except Exception as e:
        print(f"Reranker unavailable: {e}")
        reranker = None

    matcher = Matcher(reranker=reranker)

    # Load embedding texts for verification
    with open("data/embedding-texts.json") as f:
        embedding_texts = json.load(f)

    print(f"\nEvents loaded: {matcher.num_events}")
    print(f"Reranker: {'active' if reranker else 'inactive'}")
    print(f"\nRunning {len(SHOULD_MATCH)} should-match + {len(SHOULD_NOT_MATCH)} should-not-match tests...\n")

    # Test should-match
    tp = 0  # true positive
    fn = 0  # false negative
    fn_details = []
    tp_details = []

    print("=" * 80)
    print("SHOULD-MATCH TESTS")
    print("=" * 80)

    for i, (tweet, expected_substrs) in enumerate(SHOULD_MATCH):
        emb = embedder.embed_batch([tweet])[0]
        result = matcher.match(emb, tweet_text=tweet)

        if result:
            event_idx = matcher.id_to_idx.get(result["eventId"])
            event_text = embedding_texts[event_idx] if event_idx is not None else "?"
            matched_expected = any(s.lower() in event_text.lower() for s in expected_substrs)

            if matched_expected:
                tp += 1
                tp_details.append((i, tweet[:60], result["confidence"], event_text[:80]))
                print(f"  TP s{i}: conf={result['confidence']:.3f} | {tweet[:55]}...")
                print(f"         -> {event_text[:80]}")
            else:
                # Matched but to wrong event
                fn += 1
                fn_details.append((i, tweet[:60], f"WRONG: {event_text[:60]}", result["confidence"]))
                print(f"  WRONG s{i}: conf={result['confidence']:.3f} | {tweet[:55]}...")
                print(f"         -> {event_text[:80]}")
                print(f"         expected one of: {expected_substrs}")
        else:
            fn += 1
            fn_details.append((i, tweet[:60], "NO MATCH", 0))
            print(f"  FN s{i}: NO MATCH | {tweet[:55]}...")

    # Test should-not-match
    tn = 0  # true negative
    fp = 0  # false positive
    fp_details = []

    print()
    print("=" * 80)
    print("SHOULD-NOT-MATCH TESTS")
    print("=" * 80)

    for i, tweet in enumerate(SHOULD_NOT_MATCH):
        emb = embedder.embed_batch([tweet])[0]
        result = matcher.match(emb, tweet_text=tweet)

        if result:
            event_idx = matcher.id_to_idx.get(result["eventId"])
            event_text = embedding_texts[event_idx] if event_idx is not None else "?"
            fp += 1
            fp_details.append((i, tweet[:60], event_text[:60], result["confidence"]))
            print(f"  FP n{i}: conf={result['confidence']:.3f} | {tweet[:55]}...")
            print(f"         -> {event_text[:80]}")
        else:
            tn += 1
            print(f"  TN n{i}: OK | {tweet[:55]}...")

    # Summary
    print()
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"  Should-match:     TP={tp}, FN={fn} (out of {len(SHOULD_MATCH)})")
    print(f"  Should-not-match: TN={tn}, FP={fp} (out of {len(SHOULD_NOT_MATCH)})")

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    print(f"\n  Precision: {precision:.1%}")
    print(f"  Recall:    {recall:.1%}")
    print(f"  F1 Score:  {f1:.1%}")

    if fn_details:
        print(f"\n  False Negatives ({fn}):")
        for idx, text, reason, conf in fn_details:
            print(f"    s{idx}: {reason} (conf={conf:.3f}) | {text}")

    if fp_details:
        print(f"\n  False Positives ({fp}):")
        for idx, text, matched, conf in fp_details:
            print(f"    n{idx}: conf={conf:.3f} -> {matched} | {text}")

    return {"tp": tp, "fn": fn, "tn": tn, "fp": fp, "precision": precision, "recall": recall, "f1": f1}

if __name__ == "__main__":
    run_tests()

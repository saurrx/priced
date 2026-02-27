export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Predict Markets Actions Server</h1>
      <p>Solana Actions endpoint for prediction market trades via DFlow.</p>
      <p>
        <code>GET /api/actions/trade/[mint]</code> — Blink metadata<br />
        <code>POST /api/actions/trade/[mint]</code> — Execute trade
      </p>
    </main>
  );
}

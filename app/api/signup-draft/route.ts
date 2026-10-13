export const runtime = "nodejs";

// Server-side bridge: the SIGNUP_BRIDGE_TOKEN never reaches the browser.
// Creates a one-time, 15-minute signup draft on Needpedia (Rails).
export async function POST(request: Request) {
  const bridgeToken = process.env.SIGNUP_BRIDGE_TOKEN;
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  if (!bridgeToken || !baseUrl) {
    console.error("[signup-draft] SIGNUP_BRIDGE_TOKEN or NEXT_PUBLIC_API_BASE_URL missing");
    return Response.json({ error: "Signup link service not configured" }, { status: 500 });
  }

  let name = "";
  let email = "";
  try {
    const body = await request.json();
    name = typeof body.name === "string" ? body.name.trim() : "";
    email = typeof body.email === "string" ? body.email.trim() : "";
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const res = await fetch(`${baseUrl}/api/v1/signup_draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signup_draft: { name, email },
        bridge_token: bridgeToken,
      }),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = Array.isArray(data.errors) ? data.errors.join(", ") : "Draft creation failed";
      return Response.json({ error: message }, { status: res.status });
    }

    return Response.json({
      draft_token: data.draft_token,
      url: `${baseUrl}/users/sign_up?draft=${encodeURIComponent(data.draft_token)}`,
    });
  } catch (error) {
    console.error("[signup-draft] Upstream error:", error);
    return Response.json({ error: "Signup link service unavailable" }, { status: 502 });
  }
}

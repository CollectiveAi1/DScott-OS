import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.PGLITE_DIR = "memory://";

const ENV = { ...process.env };

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.APP_URL = "https://os.example.com";
});

afterEach(() => {
  process.env = { ...ENV };
});

describe("callbackUrl", () => {
  it("is APP_URL plus the callback path", async () => {
    const { callbackUrl } = await import("../src/modules/google/api");
    expect(callbackUrl()).toBe("https://os.example.com/api/google/callback");
  });

  it("does not double the slash when APP_URL has a trailing one", async () => {
    process.env.APP_URL = "https://os.example.com/";
    const { callbackUrl } = await import("../src/modules/google/api");
    expect(callbackUrl()).toBe("https://os.example.com/api/google/callback");
  });
});

describe("isConfigured", () => {
  it("needs both halves of the credential", async () => {
    const { isConfigured } = await import("../src/modules/google/api");
    expect(isConfigured()).toBe(true);
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isConfigured()).toBe(false);
    delete process.env.GOOGLE_CLIENT_ID;
    expect(isConfigured()).toBe(false);
  });
});

describe("consentUrl", () => {
  it("asks Google for exactly what §8.4 specifies", async () => {
    const { consentUrl, SCOPE } = await import("../src/modules/google/api");
    const url = new URL(consentUrl("state-token"));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(SCOPE);
    expect(SCOPE).toBe("https://www.googleapis.com/auth/calendar.readonly");
    // offline + consent every time, so a refresh token comes back on every run and not only
    // the first time this account ever authorised the app.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("https://os.example.com/api/google/callback");
    expect(url.searchParams.get("client_id")).toBe("test-client.apps.googleusercontent.com");
    expect(url.searchParams.get("state")).toBe("state-token");
  });

  it("asks for a read-only scope and nothing that could write", async () => {
    const { consentUrl } = await import("../src/modules/google/api");
    const scope = new URL(consentUrl("s")).searchParams.get("scope") ?? "";
    expect(scope).toContain(".readonly");
    expect(scope).not.toContain("calendar.events ");
    expect(scope.split(" ")).toHaveLength(1);
  });

  it("refuses to build a URL when the deployment has no credentials", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const { consentUrl } = await import("../src/modules/google/api");
    expect(() => consentUrl("s")).toThrow(/not configured/i);
  });
});

describe("the callback route", () => {
  let signedIn = true;

  beforeEach(() => {
    signedIn = true;
    vi.resetModules();
    vi.doMock("../src/lib/auth/session", () => ({
      currentOwner: async () => (signedIn ? { name: "Devon", email: "devon@example.com" } : null),
    }));
    vi.doMock("../src/lib/auth/secret", () => ({ getAuthSecret: () => "a-test-secret-long-enough-for-hmac-012345" }));
  });

  async function callback(url: string, cookie?: string) {
    const { GET } = await import("../src/app/api/google/callback/route");
    const { NextRequest } = await import("next/server");
    const request = new NextRequest(new URL(url), cookie ? { headers: { cookie } } : undefined);
    return GET(request);
  }

  it("refuses a request with no session", async () => {
    signedIn = false;
    const response = await callback("https://os.example.com/api/google/callback?code=x&state=y");
    expect(response.status).toBe(401);
  });

  it("sends Devon back with a reason when he declines at Google", async () => {
    const response = await callback("https://os.example.com/api/google/callback?error=access_denied");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("google=denied");
  });

  it("refuses a code when the state does not match the cookie", async () => {
    const { createState, STATE_COOKIE } = await import("../src/modules/google/state");
    const mine = createState("a-test-secret-long-enough-for-hmac-012345");
    const theirs = createState("a-test-secret-long-enough-for-hmac-012345");

    const response = await callback(
      `https://os.example.com/api/google/callback?code=abc&state=${encodeURIComponent(theirs)}`,
      `${STATE_COOKIE}=${mine}`,
    );
    expect(response.headers.get("location")).toContain("google=bad_state");
  });

  it("refuses a code with no state cookie at all", async () => {
    const { createState } = await import("../src/modules/google/state");
    const state = createState("a-test-secret-long-enough-for-hmac-012345");
    const response = await callback(`https://os.example.com/api/google/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(response.headers.get("location")).toContain("google=bad_state");
  });

  it("refuses a matching state that has expired", async () => {
    const { createState, STATE_COOKIE, STATE_MINUTES } = await import("../src/modules/google/state");
    const stale = createState("a-test-secret-long-enough-for-hmac-012345", Date.now() - (STATE_MINUTES + 1) * 60_000);
    const response = await callback(
      `https://os.example.com/api/google/callback?code=abc&state=${encodeURIComponent(stale)}`,
      `${STATE_COOKIE}=${stale}`,
    );
    expect(response.headers.get("location")).toContain("google=bad_state");
  });

  it("reports a good state that arrives with no code", async () => {
    const { createState, STATE_COOKIE } = await import("../src/modules/google/state");
    const state = createState("a-test-secret-long-enough-for-hmac-012345");
    const response = await callback(
      `https://os.example.com/api/google/callback?state=${encodeURIComponent(state)}`,
      `${STATE_COOKIE}=${state}`,
    );
    expect(response.headers.get("location")).toContain("google=no_code");
  });
});

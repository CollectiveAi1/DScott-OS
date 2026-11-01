// Sliding-window limiter for sign-in attempts. In-memory, so on Vercel each function instance
// keeps its own window: it slows guessing but is not a shared limit. Move to Redis/Upstash in v2.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attempts = new Map<string, number[]>();

export function checkSignInAllowed(key: string, now = Date.now()): { allowed: boolean; retryInMinutes: number } {
  const recent = (attempts.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  attempts.set(key, recent);
  if (recent.length < MAX_ATTEMPTS) return { allowed: true, retryInMinutes: 0 };
  const oldest = recent[0] ?? now;
  return { allowed: false, retryInMinutes: Math.ceil((WINDOW_MS - (now - oldest)) / 60000) };
}

export function recordFailedSignIn(key: string, now = Date.now()): void {
  attempts.set(key, [...(attempts.get(key) ?? []), now]);
}

export function clearSignInFailures(key: string): void {
  attempts.delete(key);
}

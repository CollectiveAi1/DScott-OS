import { describe, expect, it } from "vitest";
import { hasRealProvider, NO_PROVIDER_MESSAGE } from "../src/modules/approvals/providers";

/**
 * Going live is the single switch that would let an approval reach a real person. Two things
 * have to be true: Devon typed LIVE, and something exists that could deliver. In v1 the second
 * is false, so the switch cannot be thrown at all.
 */
describe("going live", () => {
  it("has no provider to go live with in v1", () => {
    expect(hasRealProvider()).toBe(false);
  });

  it("explains the refusal in terms of what is missing", () => {
    expect(NO_PROVIDER_MESSAGE).toMatch(/provider/i);
    expect(NO_PROVIDER_MESSAGE).toMatch(/blocked/i);
  });
});

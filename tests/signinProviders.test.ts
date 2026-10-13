// Sign-in and sign-up provider buttons: which show, in what order, one divider, and the Google callback results.
import { describe, expect, it } from "vitest";
import {
  googleCallbackResult,
  googleFailureUrl,
  googleSigninEnabled,
  PROVIDER_LABEL,
  providerView,
  startHref,
} from "@/lib/signinProviders";

describe("provider buttons", () => {
  it("shows nothing with neither provider set up, so the page is just the email form", () => {
    expect(providerView({ openctrl: false, google: false })).toEqual({ buttons: [], divider: false, notices: [] });
    expect(providerView({})).toEqual({ buttons: [], divider: false, notices: [] });
  });

  it("puts OpenCtrl above Google, then one divider", () => {
    const v = providerView({ google: true, openctrl: true });
    expect(v.buttons).toEqual(["openctrl", "google"]);
    expect(v.buttons.map((p) => PROVIDER_LABEL[p])).toEqual(["Continue with OpenCtrl", "Continue with Google"]);
    expect(v.divider).toBe(true);
  });

  it("shows each provider only when it's set up", () => {
    expect(providerView({ openctrl: true, google: false }).buttons).toEqual(["openctrl"]);
    expect(providerView({ openctrl: false, google: true }).buttons).toEqual(["google"]);
    expect(providerView({ google: true }).divider).toBe(true);
  });

  it("steps the buttons aside while an OpenCtrl link waits for the password", () => {
    const v = providerView({ openctrl: true, google: true }, { openctrl: "link" });
    expect(v.buttons).toEqual([]);
    expect(v.divider).toBe(false);
    expect(v.notices).toEqual([{ role: "status", text: expect.stringMatching(/Sign in with its password once/) }]);
  });

  it("shows the last attempt's result as an error, even when the provider is now off", () => {
    expect(providerView({}, { google: "cancelled" }).notices).toEqual([{ role: "alert", text: "Sign-in with Google was cancelled." }]);
    expect(providerView({}, { openctrl: "off" }).notices[0].role).toBe("alert");
    expect(providerView({ google: true }, { google: "failed" }).buttons).toEqual(["google"]);
  });

  it("ignores result codes it doesn't know", () => {
    expect(providerView({ google: true }, { google: "<script>", openctrl: "nope" }).notices).toEqual([]);
  });

  it("keeps where to go next on the start links", () => {
    expect(startHref("google", "/invite/abc?x=1")).toBe("/auth/google/start?next=%2Finvite%2Fabc%3Fx%3D1");
    expect(startHref("openctrl", "/app")).toBe("/auth/openctrl/start?next=%2Fapp");
  });
});

describe("Google", () => {
  it("is on only with CTRLROOM_GOOGLE_SIGNIN=1", () => {
    expect(googleSigninEnabled({ CTRLROOM_GOOGLE_SIGNIN: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", "yes"]) expect(googleSigninEnabled({ CTRLROOM_GOOGLE_SIGNIN: v })).toBe(false);
  });

  it("reads the callback: cancelled, failed, or a code to exchange", () => {
    expect(googleCallbackResult({ code: null, error: "access_denied" })).toBe("cancelled");
    expect(googleCallbackResult({ code: null, error: "server_error" })).toBe("failed");
    expect(googleCallbackResult({ code: "abc", error: "server_error" })).toBe("failed");
    expect(googleCallbackResult({ code: null, error: null })).toBe("failed");
    expect(googleCallbackResult({ code: "abc", error: null })).toBeNull();
  });

  it("sends failures back to the sign-in page with next kept", () => {
    expect(googleFailureUrl("cancelled", "/c/demo")).toBe("/login?google=cancelled&next=%2Fc%2Fdemo");
    for (const r of ["cancelled", "failed", "expired", "off"]) expect(providerView({}, { google: r }).notices).toHaveLength(1);
  });
});

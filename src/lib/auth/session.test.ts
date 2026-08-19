import { afterEach, describe, expect, it } from "vitest";
import {
  checkAccessCode,
  isGateOpen,
  isValidSession,
  issueSession,
} from "@/lib/auth/session";

/**
 * The gate is the only thing standing between a public URL and someone else's
 * render credits, so the tests that matter are the ones about forgery and
 * expiry — not the happy path.
 */

const ORIGINAL = process.env.APP_ACCESS_CODE;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_ACCESS_CODE;
  else process.env.APP_ACCESS_CODE = ORIGINAL;
  delete process.env.APP_SESSION_SECRET;
});

describe("access gate", () => {
  it("is open when no code is configured, so a fresh clone runs", () => {
    delete process.env.APP_ACCESS_CODE;
    expect(isGateOpen()).toBe(true);
    expect(checkAccessCode("anything")).toBe(true);
  });

  it("accepts the configured code and rejects anything else", () => {
    process.env.APP_ACCESS_CODE = "abrelasesamo";
    expect(checkAccessCode("abrelasesamo")).toBe(true);
    expect(checkAccessCode("abrelasesamo ")).toBe(true); // trimmed
    expect(checkAccessCode("abrelasesam")).toBe(false);
    expect(checkAccessCode("")).toBe(false);
  });
});

describe("session cookie", () => {
  it("accepts a cookie it just issued", async () => {
    process.env.APP_ACCESS_CODE = "codigo";
    const session = await issueSession();
    expect(await isValidSession(session.value)).toBe(true);
  });

  it("rejects a forged signature", async () => {
    process.env.APP_ACCESS_CODE = "codigo";
    const session = await issueSession();
    const [payload] = session.value.split(".");

    // A future expiry with a made-up signature is the obvious attack.
    expect(await isValidSession(`${payload}.deadbeef`)).toBe(false);
    expect(await isValidSession(`${Number(payload) + 86_400_000}.x`)).toBe(false);
  });

  it("rejects a cookie signed with a different secret", async () => {
    process.env.APP_ACCESS_CODE = "codigo";
    process.env.APP_SESSION_SECRET = "antiguo";
    const session = await issueSession();

    // Rotating the secret has to invalidate every session in the wild.
    process.env.APP_SESSION_SECRET = "nuevo";
    expect(await isValidSession(session.value)).toBe(false);
  });

  it("rejects an expired cookie", async () => {
    process.env.APP_ACCESS_CODE = "codigo";
    const session = await issueSession(0);
    expect(await isValidSession(session.value, Date.now())).toBe(false);
  });

  it("rejects nothing at all", async () => {
    process.env.APP_ACCESS_CODE = "codigo";
    expect(await isValidSession(undefined)).toBe(false);
    expect(await isValidSession("")).toBe(false);
    expect(await isValidSession("sinpunto")).toBe(false);
  });
});

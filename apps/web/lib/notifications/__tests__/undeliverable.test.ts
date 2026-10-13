import { describe, expect, it } from "vitest";
import { isUndeliverableAddress } from "../undeliverable";

describe("isUndeliverableAddress", () => {
  it.each(["admin@jagsassurance.local", "client@meridian.demo", "qa@example.test", "a@example.com", "a@example.demo", "x@host.invalid", "a@B.LOCAL", "nodomain", "a@localhost", "", null, undefined])(
    "treats %s as undeliverable",
    (e) => expect(isUndeliverableAddress(e as string | null | undefined)).toBe(true)
  );
  it.each(["harish.varri@hrud.ai", "pat@client.co.uk", "a@mail.example-corp.com"])("keeps %s", (e) => expect(isUndeliverableAddress(e)).toBe(false));
});

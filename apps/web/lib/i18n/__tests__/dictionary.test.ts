import { describe, expect, it } from "vitest";
import { localizeNavItems, translateText } from "../dictionary";

describe("translateText (English only)", () => {
  it("returns English text unchanged", () => {
    expect(translateText("en", "Projects")).toBe("Projects");
    expect(translateText("en", "Something not in the list")).toBe("Something not in the list");
  });
});

describe("localizeNavItems", () => {
  const items = [{ label: "Projects", href: "/p", group: "Plan" }];
  it("is a no-op for English", () => {
    expect(localizeNavItems(items, "en")).toBe(items);
  });
});

import { describe, expect, it } from "vitest";
import { localizeNavItems, translateText } from "../dictionary";

interface Nav {
  label: string;
  href: string;
  group?: string;
  displayLabel?: string;
  displayGroup?: string;
  children?: Nav[];
}

describe("translateText", () => {
  it("translates known text and leaves unknown text English", () => {
    expect(translateText("ar", "Projects")).toBe("المشاريع");
    expect(translateText("ar", "Something not in the list")).toBe("Something not in the list");
    expect(translateText("en", "Projects")).toBe("Projects");
  });
});

describe("localizeNavItems", () => {
  const items: Nav[] = [
    { label: "Projects", href: "/p", group: "Plan" },
    { label: "Settings", href: "/s", children: [{ label: "Numbering", href: "/n" }] },
  ];
  it("is a no-op for English", () => {
    expect(localizeNavItems(items, "en")).toBe(items);
  });
  it("adds display text for Arabic and keeps the English label", () => {
    const out = localizeNavItems(items, "ar");
    expect(out[0].label).toBe("Projects");
    expect(out[0].displayLabel).toBe("المشاريع");
    expect(out[0].displayGroup).toBe("التخطيط");
    expect(out[1].children?.[0].displayLabel).toBe("الترقيم");
  });
  it("does not mutate the input", () => {
    localizeNavItems(items, "ar");
    expect(items[0].displayLabel).toBeUndefined();
  });
});

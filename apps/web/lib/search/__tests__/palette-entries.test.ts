import { describe, expect, it } from "vitest";
import { filterEntries, flattenNavItems } from "../palette-entries";

const nav = [
  {
    label: "Dashboard",
    href: "/inspect",
    palette: [
      { label: "Punch list (choose a project)", href: "/inspect/projects" },
      { label: "Registers (choose a project)", href: "/inspect/projects" },
    ],
  },
  { label: "Projects", href: "/inspect/projects" },
  { label: "Inspections", href: "/inspect/inspections" },
  {
    label: "Settings",
    href: "/inspect/settings",
    children: [{ label: "Staff Access", href: "/inspect/settings?section=staff-access" }],
  },
];

describe("palette entries", () => {
  const entries = flattenNavItems(nav);
  it("includes sidebar leaves, palette extras and nested children", () => {
    const labels = entries.map((e) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Dashboard", "Projects", "Inspections", "Staff Access", "Punch list (choose a project)", "Registers (choose a project)"]),
    );
  });
  it("gives nested items a group path", () => {
    expect(entries.find((e) => e.label === "Staff Access")?.path).toBe("Settings › Staff Access");
  });
  it("filters by every term", () => {
    expect(filterEntries(entries, "punch").map((e) => e.label)).toEqual(["Dashboard › Punch list (choose a project)".split(" › ")[1]]);
    expect(filterEntries(entries, "staff access")).toHaveLength(1);
    expect(filterEntries(entries, "zzz")).toHaveLength(0);
    expect(filterEntries(entries, "")).toHaveLength(entries.length);
  });
});

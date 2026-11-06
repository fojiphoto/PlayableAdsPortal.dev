import { describe, it, expect } from "vitest";
import { legacyRoute, parseRoute, routePath, titleFor, type Route } from "./router";

const A = "6f1c2a9e-1111-4c4c-9a9a-000000000001";
const C = "6f1c2a9e-2222-4c4c-9a9a-000000000002";
const CR = "6f1c2a9e-3333-4c4c-9a9a-000000000003";

describe("router", () => {
  it("round-trips every screen through its path", () => {
    const routes: [Route, string][] = [
      [{ page: "app" }, "/"],
      [{ page: "app", appId: A }, `/apps/${A}`],
      [{ page: "app", appId: A, conceptId: C }, `/apps/${A}/concepts/${C}`],
      [{ page: "app", appId: A, conceptId: C, creativeId: CR }, `/apps/${A}/concepts/${C}/creatives/${CR}`],
      [{ page: "start" }, "/start"],
      [{ page: "plans" }, "/plans"],
      [{ page: "settings" }, "/settings"],
      [{ page: "analytics" }, "/analytics"],
      [{ page: "preloader" }, "/preloader"],
      [{ page: "domain" }, "/domain"],
      [{ page: "support" }, "/support"],
      [{ page: "support", threadId: C }, `/support/${C}`],
      [{ page: "admin" }, "/admin"],
      [{ page: "admin", tab: "plugin" }, "/admin/plugin"],
      [{ page: "admin", tab: "support", threadId: C }, `/admin/support/${C}`],
    ];
    for (const [r, path] of routes) {
      expect(routePath(r)).toBe(path);
      expect(parseRoute(path)).toEqual(Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));
    }
    expect(parseRoute("/apps/x/")).toEqual({ page: "app", appId: "x" }); // trailing slash
    expect(routePath({ page: "admin", tab: "overview" })).toBe("/admin");
  });

  it("rejects paths that aren't screens", () => {
    for (const bad of ["/nope", "/apps", `/apps/${A}/oops`, `/apps/${A}/concepts`, `/apps/${A}/concepts/${C}/creatives`, "/settings/x", "/support/a/b", "/admin/a/b", "/apps/%3Cscript%3E", "/api/apps"])
      expect(parseRoute(bad), bad).toBeNull();
  });

  it("maps the old query-string email links onto paths", () => {
    expect(legacyRoute(`?support=${C}`)).toEqual({ page: "support", threadId: C });
    expect(legacyRoute(`?admin=support&thread=${C}`)).toEqual({ page: "admin", tab: "support", threadId: C });
    expect(legacyRoute("?admin=bugs")).toEqual({ page: "admin", tab: "bugs", threadId: undefined });
    expect(legacyRoute("?verify=abc")).toBeNull();
    expect(legacyRoute("?support=<x>")).toBeNull();
  });

  it("titles", () => {
    expect(titleFor({ page: "preloader" })).toBe("Preloader kits · Factorial AdLab");
  });
});

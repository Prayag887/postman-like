import { describe, expect, it } from "vitest";
import { parseCurl, removeRequestAndChooseNext } from "./App";
import type { ApiRequest } from "./types";

function request(id: string): ApiRequest {
  return {
    id,
    collection_id: "collection",
    folder_path: [],
    name: id,
    method: "GET",
    url: `https://example.com/${id}`,
    headers: [],
    query: [],
    body_kind: "none",
    auth: { type: "none" },
    assertions: [],
    extractions: [],
    disabled: false,
  };
}

describe("request deletion", () => {
  it("discards an unsaved request and selects the first saved request", () => {
    const saved = [request("first"), request("second")];
    const result = removeRequestAndChooseNext(saved, "unsaved");

    expect(result.removed).toBe(false);
    expect(result.requests).toBe(saved);
    expect(result.next?.id).toBe("first");
  });

  it("removes a saved request and selects its next neighbor", () => {
    const result = removeRequestAndChooseNext(
      [request("first"), request("second"), request("third")],
      "second",
    );

    expect(result.removed).toBe(true);
    expect(result.requests.map((item) => item.id)).toEqual(["first", "third"]);
    expect(result.next?.id).toBe("third");
  });
});

describe("cURL paste", () => {
  it("maps a pasted cURL command into all request fields", () => {
    const imported = parseCurl(
      "curl --request POST 'https://api.example.com/users?page=2' --header 'Authorization: Bearer token' --header 'Content-Type: application/json' --data-raw '{\"name\":\"Ada\"}'",
      "collection",
    );

    expect(imported.method).toBe("POST");
    expect(imported.url).toBe("https://api.example.com/users");
    expect(imported.query).toEqual([
      { key: "page", value: "2", enabled: true },
    ]);
    expect(imported.auth).toEqual({ type: "bearer", token: "token" });
    expect(imported.headers).toContainEqual({
      key: "Content-Type",
      value: "application/json",
      enabled: true,
    });
    expect(imported.body).toBe('{"name":"Ada"}');
  });
});

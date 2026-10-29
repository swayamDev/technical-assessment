import { describe, expect, it } from "vitest";
import {
  csrfRejection,
  mutationRequestFrom,
  type MutationRequest,
} from "./csrf";

const browserPost: MutationRequest = {
  method: "POST",
  origin: "http://localhost:3000",
  host: "localhost:3000",
  forwardedHost: null,
  contentType: "application/json",
};

describe("csrfRejection", () => {
  it("allows a same-origin JSON mutation from the app's own pages", () => {
    expect(csrfRejection(browserPost)).toBeNull();
    expect(
      csrfRejection({
        ...browserPost,
        contentType: "application/json; charset=utf-8",
      }),
    ).toBeNull();
    expect(
      csrfRejection({ ...browserPost, contentType: "Application/JSON" }),
    ).toBeNull();
  });

  it("allows safe methods without any checks", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(
        csrfRejection({
          method,
          origin: "https://evil.example",
          host: "localhost:3000",
          forwardedHost: null,
          contentType: null,
        }),
      ).toBeNull();
    }
  });

  it("refuses cross-origin mutations, including other ports and subdomains", () => {
    for (const origin of [
      "https://evil.example",
      "http://localhost:4000",
      "http://evil.localhost:3000",
      "null",
      "not a url",
    ]) {
      expect(csrfRejection({ ...browserPost, origin })).toBe(
        "Cross-origin request refused",
      );
    }
  });

  it("refuses mutations without an Origin header", () => {
    expect(csrfRejection({ ...browserPost, origin: null })).toBe(
      "Cross-origin request refused",
    );
  });

  it("refuses unexpected content types, including the ones a form or a simple fetch can send", () => {
    for (const contentType of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      null,
      "",
    ]) {
      expect(csrfRejection({ ...browserPost, contentType })).toBe(
        "Content-Type must be application/json",
      );
    }
  });

  it("compares against X-Forwarded-Host behind a proxy", () => {
    const proxied = {
      ...browserPost,
      origin: "https://rent.example.com",
      host: "127.0.0.1:3000",
      forwardedHost: "rent.example.com",
    };
    expect(csrfRejection(proxied)).toBeNull();
    expect(
      csrfRejection({
        ...proxied,
        forwardedHost: "rent.example.com, internal",
      }),
    ).toBeNull();
    expect(csrfRejection({ ...proxied, origin: "https://evil.example" })).toBe(
      "Cross-origin request refused",
    );
  });

  it("reads the relevant headers from a Request", () => {
    const request = new Request("http://localhost:3000/api/leases", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        host: "localhost:3000",
        "content-type": "application/json",
      },
    });
    const parsed = mutationRequestFrom(request);
    expect(parsed.method).toBe("POST");
    expect(parsed.origin).toBe("http://localhost:3000");
    expect(parsed.contentType).toBe("application/json");
  });
});

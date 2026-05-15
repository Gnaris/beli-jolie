/**
 * Tests pour app/favicon.ico/route.ts
 *
 * Vérifie que /favicon.ico redirige vers /icon (route dynamique générée
 * par Next à partir de la 1re lettre du shopName ou du favicon perso uploadé).
 */
import { describe, expect, it } from "vitest";
import { GET } from "@/app/favicon.ico/route";

describe("/favicon.ico", () => {
  it("redirige vers /icon avec un 308 permanent", async () => {
    const request = new Request("https://beliandjolie.com/favicon.ico");
    const response = await GET(request);
    expect(response.status).toBe(308);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe("/icon");
  });

  it("préserve le host de la requête dans la redirection", async () => {
    const request = new Request("https://example.com/favicon.ico");
    const response = await GET(request);
    const location = response.headers.get("location");
    expect(new URL(location!).host).toBe("example.com");
  });
});

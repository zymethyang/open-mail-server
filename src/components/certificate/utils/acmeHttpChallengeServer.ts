import http from "node:http";
import type { Server } from "node:net";
import { ServerPort } from "../../configuration/enums/serverPort.js";
import { listen } from "../../protocol/utils/listen.js";
import type { AcmeChallengeStore } from "./acmeChallengeStore.js";

const challengePathPrefix = "/.well-known/acme-challenge/";
const tokenPattern = /^[A-Za-z0-9_-]+$/;

export function createAcmeHttpChallengeServer(challengeStore: AcmeChallengeStore): http.Server {
  return http.createServer((request, response) => {
    const method = request.method || "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Not found");
      return;
    }
    let pathName = "/";
    try {
      pathName = new URL(request.url || "/", "http://127.0.0.1").pathname;
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Not found");
      return;
    }
    if (!pathName.startsWith(challengePathPrefix)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Not found");
      return;
    }
    const token = pathName.slice(challengePathPrefix.length);
    if (!token || token.includes("/") || !tokenPattern.test(token)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Not found");
      return;
    }
    const keyAuthorization = challengeStore.get(token);
    if (!keyAuthorization) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Not found");
      return;
    }
    const body = Buffer.from(keyAuthorization, "utf8");
    response.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": body.length,
      "Cache-Control": "no-store"
    });
    if (method === "HEAD") {
      response.end();
      return;
    }
    response.end(body);
  });
}

export async function startAcmeHttpChallengeServer(
  challengeStore: AcmeChallengeStore,
  host: string,
  port: number = ServerPort.Http
): Promise<{ server: Server; port: number }> {
  const server = createAcmeHttpChallengeServer(challengeStore);
  const listeningPort = await listen(server, port, host);
  return { server, port: listeningPort };
}

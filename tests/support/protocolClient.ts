import net from "node:net";
import tls from "node:tls";

export function responseFinished(received: string, options?: { tag?: string; dotTerminated?: boolean }): boolean {
  if (!received.endsWith("\r\n")) {
    return false;
  }
  if (options?.dotTerminated) {
    return received.includes("\r\n.\r\n");
  }
  const lines = received.split("\r\n").filter((line) => line.length > 0);
  const last = lines[lines.length - 1] || "";
  if (options?.tag) {
    return last.startsWith(`${options.tag} `);
  }
  if (last.startsWith("+OK") || last.startsWith("-ERR") || last.startsWith("+")) {
    return true;
  }
  if (/^\d{3} /.test(last)) {
    return true;
  }
  return lines.length === 1 && last.startsWith("* ");
}

export async function readResponse(socket: net.Socket, options?: { tag?: string; dotTerminated?: boolean }): Promise<string> {
  let received = "";
  while (!responseFinished(received, options)) {
    const chunk = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out after: ${received}`)), 5000);
      const onData = (data: Buffer) => {
        clearTimeout(timer);
        socket.off("error", onError);
        resolve(data);
      };
      const onError = (error: Error) => {
        clearTimeout(timer);
        socket.off("data", onData);
        reject(error);
      };
      socket.once("data", onData);
      socket.once("error", onError);
    });
    received += chunk.toString("utf8");
  }
  return received;
}

export function connectPlain(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

export function connectTrustedTls(port: number, certificate: string, serverName: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port,
      servername: serverName,
      ca: certificate,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2"
    });
    socket.once("secureConnect", () => resolve(socket));
    socket.once("error", reject);
  });
}

export function upgradeToTrustedTls(socket: net.Socket, certificate: string, serverName: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({
      socket,
      servername: serverName,
      ca: certificate,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2"
    });
    secureSocket.once("secureConnect", () => resolve(secureSocket));
    secureSocket.once("error", reject);
  });
}

export function connectTls(port: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port,
      rejectUnauthorized: false,
      minVersion: "TLSv1.2"
    });
    socket.once("secure", () => resolve(socket));
    socket.once("error", reject);
  });
}

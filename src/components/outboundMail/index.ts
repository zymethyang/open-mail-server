import net from "node:net";
import tls from "node:tls";
import { RelaySecurity } from "../settings/enums/relaySecurity.js";
import type { MailExchange } from "../mailExchange/interfaces/mailExchange.js";
import type { OutboundDelivery, SubmissionRelay } from "./interfaces/outboundDelivery.js";
export type { OutboundDelivery, SubmissionRelay };

function dotStuff(buffer: Buffer): Buffer {
  const pieces: Buffer[] = [];
  let lineStart = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0x0d && buffer[index + 1] === 0x0a) {
      const line = buffer.subarray(lineStart, index);
      if (line[0] === 0x2e) {
        pieces.push(Buffer.from("."));
      }
      pieces.push(line, Buffer.from("\r\n"));
      index += 1;
      lineStart = index + 1;
    }
  }
  const lastLine = buffer.subarray(lineStart);
  if (lastLine.length) {
    if (lastLine[0] === 0x2e) {
      pieces.push(Buffer.from("."));
    }
    pieces.push(lastLine, Buffer.from("\r\n"));
  }
  pieces.push(Buffer.from(".\r\n"));
  return Buffer.concat(pieces);
}

class SmtpConversation {
  private buffer = Buffer.alloc(0);

  constructor(private socket: net.Socket) {}

  async readResponse(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine();
      lines.push(line);
      if (line.length >= 4 && line[3] === " ") {
        return { code: Number(line.slice(0, 3)), lines };
      }
      if (line.length < 4 || line[3] !== "-") {
        return { code: Number(line.slice(0, 3)) || 500, lines };
      }
    }
  }

  writeLine(line: string): Promise<void> {
    return this.write(Buffer.from(`${line}\r\n`, "utf8"));
  }

  write(chunk: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(chunk, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  upgrade(host: string, trustedCertificate = ""): Promise<void> {
    return new Promise((resolve, reject) => {
      const secureSocket = tls.connect({
        socket: this.socket,
        ...tlsSecurity(host, trustedCertificate)
      });
      const fail = (error: Error) => {
        secureSocket.destroy();
        reject(error);
      };
      secureSocket.once("secure", () => {
        secureSocket.off("error", fail);
        this.socket = secureSocket;
        this.buffer = Buffer.alloc(0);
        resolve();
      });
      secureSocket.once("error", fail);
    });
  }

  close(): void {
    this.socket.end();
  }

  private readLine(): Promise<string> {
    const existing = this.takeLine();
    if (existing !== null) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("The remote mail server timed out"));
      }, 20000);
      const onData = (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const line = this.takeLine();
        if (line !== null) {
          cleanup();
          resolve(line);
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("data", onData);
        this.socket.off("error", onError);
        this.socket.off("close", onError);
      };
      this.socket.on("data", onData);
      this.socket.once("error", onError);
      this.socket.once("close", onError);
    });
  }

  private takeLine(): string | null {
    const splitAt = this.buffer.indexOf("\r\n");
    if (splitAt === -1) {
      return null;
    }
    const line = this.buffer.subarray(0, splitAt).toString("utf8");
    this.buffer = this.buffer.subarray(splitAt + 2);
    return line;
  }
}

function certificateServerName(host: string): string | undefined {
  return net.isIP(host) ? undefined : host;
}

function tlsSecurity(host: string, trustedCertificate: string): tls.ConnectionOptions {
  return {
    servername: certificateServerName(host),
    ca: trustedCertificate || undefined,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    checkServerIdentity: (_hostname, certificate) => tls.checkServerIdentity(host, certificate)
  };
}

function connect(exchange: MailExchange): Promise<net.Socket> {
  return openSocket(exchange, net.connect({ host: exchange.host, port: exchange.port }), false);
}

function connectTransportSecurity(exchange: MailExchange): Promise<tls.TLSSocket> {
  return openSocket(
    exchange,
    tls.connect({
      host: exchange.host,
      port: exchange.port,
      ...tlsSecurity(exchange.host, exchange.trustedCertificate || "")
    }),
    true
  );
}

function openSocket<T extends net.Socket>(exchange: MailExchange, socket: T, waitForSecure: boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    const ready = () => {
      socket.off("error", fail);
      socket.setTimeout(0);
      resolve(socket);
    };
    socket.setTimeout(20000, () => fail(new Error(`Timed out connecting to ${exchange.host}`)));
    socket.once(waitForSecure ? "secure" : "connect", ready);
    socket.once("error", fail);
  });
}

async function expect(conversation: SmtpConversation, minimum: number, maximum: number, label: string): Promise<string> {
  const response = await conversation.readResponse();
  if (response.code < minimum || response.code > maximum) {
    throw new Error(`${label} was refused: ${response.lines.join(" ")}`);
  }
  return response.lines.join("\n");
}

export async function deliverToExchange(exchange: MailExchange, delivery: OutboundDelivery, relay?: SubmissionRelay | null): Promise<void> {
  const socket = relay?.security === RelaySecurity.Tls ? await connectTransportSecurity(exchange) : await connect(exchange);
  const conversation = new SmtpConversation(socket);
  try {
    await expect(conversation, 200, 299, "Greeting");
    const features = await greet(conversation, delivery.serverDomain);
    let secured = relay?.security === RelaySecurity.Tls;
    if (!secured && (!relay || relay.security === RelaySecurity.StartTls) && /STARTTLS/i.test(features)) {
      await conversation.writeLine("STARTTLS");
      await expect(conversation, 200, 299, "STARTTLS");
      await conversation.upgrade(exchange.host, exchange.trustedCertificate || "");
      secured = true;
      await greet(conversation, delivery.serverDomain);
    }
    if (!secured && relay?.security !== RelaySecurity.Plain) {
      throw new Error("The mail server did not offer TLS");
    }
    if (relay?.username) {
      const token = Buffer.from(`\u0000${relay.username}\u0000${relay.password}`, "utf8").toString("base64");
      await conversation.writeLine(`AUTH PLAIN ${token}`);
      await expect(conversation, 200, 299, "Relay authentication");
    }
    const from = delivery.senderAddress ? `<${delivery.senderAddress}>` : "<>";
    await conversation.writeLine(`MAIL FROM:${from}`);
    await expect(conversation, 200, 299, "Sender");
    for (const recipient of delivery.recipientAddresses) {
      await conversation.writeLine(`RCPT TO:<${recipient}>`);
      await expect(conversation, 200, 299, `Recipient ${recipient}`);
    }
    await conversation.writeLine("DATA");
    await expect(conversation, 300, 399, "Data");
    await conversation.write(dotStuff(delivery.rawMessage));
    await expect(conversation, 200, 299, "Message");
    await conversation.writeLine("QUIT");
  } finally {
    conversation.close();
  }
}

async function greet(conversation: SmtpConversation, serverDomain: string): Promise<string> {
  await conversation.writeLine(`EHLO ${serverDomain || "localhost"}`);
  return expect(conversation, 200, 299, "Greeting name");
}

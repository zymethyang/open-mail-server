import net from "node:net";
import tls from "node:tls";
import { generateAuthoritySignedCertificate } from "../../src/components/certificate/utils/selfSignedCertificate.js";
import type { MailExchange } from "../../src/components/mailExchange/interfaces/mailExchange.js";

export interface SmtpSink {
  port: number;
  messages: string[];
  envelopeSenders: string[];
  envelopeRecipients: string[];
  trustedCertificate: string;
  stop(): Promise<void>;
}

export function sinkMailExchange(sink: SmtpSink): MailExchange {
  return { host: "127.0.0.1", port: sink.port, trustedCertificate: sink.trustedCertificate };
}

export async function startSmtpSink(options: { offerTransportSecurity?: boolean } = {}): Promise<SmtpSink> {
  const offerTransportSecurity = options.offerTransportSecurity !== false;
  const certificate = generateAuthoritySignedCertificate(["127.0.0.1"]);
  const secureContext = tls.createSecureContext({
    cert: `${certificate.certificate}\n${certificate.intermediateCertificate}`,
    key: certificate.privateKey
  });
  const messages: string[] = [];
  const envelopeSenders: string[] = [];
  const envelopeRecipients: string[] = [];
  const server = net.createServer((socket) => {
    let current: net.Socket = socket;
    let buffer = "";
    let collecting = false;
    let secured = false;
    const write = (line: string) => {
      current.write(line);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      while (true) {
        if (collecting) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) {
            return;
          }
          messages.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          collecting = false;
          write("250 accepted\r\n");
          continue;
        }
        const splitAt = buffer.indexOf("\r\n");
        if (splitAt === -1) {
          return;
        }
        const line = buffer.slice(0, splitAt);
        buffer = buffer.slice(splitAt + 2);
        const command = line.split(" ")[0].toUpperCase();
        if (command === "EHLO" || command === "HELO") {
          if (offerTransportSecurity && !secured) {
            write("250-sink.example.test\r\n250 STARTTLS\r\n");
          } else {
            write("250 sink.example.test\r\n");
          }
        } else if (command === "STARTTLS") {
          if (!offerTransportSecurity || secured) {
            write("454 TLS is not available on the test sink\r\n");
            continue;
          }
          write("220 Ready to start TLS\r\n");
          socket.removeListener("data", onData);
          const secureSocket = new tls.TLSSocket(socket, { isServer: true, secureContext });
          current = secureSocket;
          secured = true;
          buffer = "";
          secureSocket.on("data", onData);
          secureSocket.on("error", () => secureSocket.destroy());
        } else if (command === "MAIL") {
          envelopeSenders.push(line);
          write("250 ok\r\n");
        } else if (command === "RCPT") {
          envelopeRecipients.push(line);
          write("250 ok\r\n");
        } else if (command === "DATA") {
          write("354 continue\r\n");
          collecting = true;
        } else if (command === "QUIT") {
          write("221 bye\r\n");
          current.end();
        } else {
          write("250 ok\r\n");
        }
      }
    };
    write("220 sink.example.test ready\r\n");
    socket.on("data", onData);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The test mail sink did not start");
  }
  return {
    port: address.port,
    messages,
    envelopeSenders,
    envelopeRecipients,
    trustedCertificate: certificate.rootCertificate,
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}

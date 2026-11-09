import net from "node:net";

export interface SmtpSink {
  port: number;
  messages: string[];
  envelopeSenders: string[];
  envelopeRecipients: string[];
  stop(): Promise<void>;
}

export async function startSmtpSink(): Promise<SmtpSink> {
  const messages: string[] = [];
  const envelopeSenders: string[] = [];
  const envelopeRecipients: string[] = [];
  const server = net.createServer((socket) => {
    socket.write("220 sink.example.test ready\r\n");
    let buffer = "";
    let collecting = false;
    socket.on("data", (chunk) => {
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
          socket.write("250 accepted\r\n");
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
          socket.write("250 sink.example.test\r\n");
        } else if (command === "STARTTLS") {
          socket.write("454 TLS is not available on the test sink\r\n");
        } else if (command === "MAIL") {
          envelopeSenders.push(line);
          socket.write("250 ok\r\n");
        } else if (command === "RCPT") {
          envelopeRecipients.push(line);
          socket.write("250 ok\r\n");
        } else if (command === "DATA") {
          socket.write("354 continue\r\n");
          collecting = true;
        } else if (command === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
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

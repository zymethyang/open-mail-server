import net from "node:net";
import tls from "node:tls";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { loadConfiguration } from "./components/configuration/index.js";
import { ApiEndpoint } from "./components/web/enums/apiEndpoint.js";
import { startEmailServer } from "./components/emailServer/index.js";
import { parseRawMessage } from "./components/mime/index.js";

const storageDirectory = await mkdtemp(path.join(os.tmpdir(), "email-server-"));
const base = loadConfiguration();
const configuration = {
  ...base,
  host: "127.0.0.1",
  storageDirectory,
  webPort: 0,
  smtpPort: 0,
  smtpSecurePort: 0,
  smtpSubmissionPort: 0,
  imapPort: 0,
  imapSecurePort: 0,
  pop3Port: 0,
  pop3SecurePort: 0,
  configuredDomain: "acme.test",
  secureWeb: false
};

let sinkPort = 0;
const sinkMessages: string[] = [];
const sink = net.createServer((socket) => {
  socket.write("220 sink.example.test ready\r\n");
  let buffer = "";
  let collecting = false;
  const lines: string[] = [];
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (true) {
      if (collecting) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end === -1) {
          return;
        }
        sinkMessages.push(buffer.slice(0, end));
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
      lines.push(line);
      const command = line.split(" ")[0].toUpperCase();
      if (command === "EHLO" || command === "HELO") {
        socket.write("250 sink.example.test\r\n");
      } else if (command === "STARTTLS") {
        socket.write("454 TLS is not available on the test sink\r\n");
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
await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", () => resolve()));
sinkPort = (sink.address() as net.AddressInfo).port;

const running = await startEmailServer({
  configuration,
  mailExchangeResolver: {
    async resolve() {
      return [{ host: "127.0.0.1", port: sinkPort }];
    }
  }
});

function port(name: string, security: string): number {
  const listener = running.listeners.find((item) => item.name === name && item.security === security && item.started);
  if (!listener) {
    throw new Error(`${name} ${security} did not start: ${running.listeners.map((item) => `${item.name} ${item.security} ${item.detail}`).join("; ")}`);
  }
  return listener.port;
}

const webPort = port("Web", "HTTP");
const failures: string[] = [];

function check(condition: unknown, message: string): void {
  if (!condition) {
    failures.push(message);
  }
}

function responseFinished(received: string, options?: { tag?: string; dotTerminated?: boolean }): boolean {
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

async function readResponse(socket: net.Socket, options?: { tag?: string; dotTerminated?: boolean }): Promise<string> {
  let received = "";
  while (!responseFinished(received, options)) {
    const chunk = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out after: ${received}`)), 5000);
      socket.once("data", (data) => {
        clearTimeout(timer);
        resolve(data);
      });
      socket.once("error", reject);
    });
    received += chunk.toString("utf8");
  }
  return received;
}

try {
  const setup = await fetch(`http://127.0.0.1:${webPort}${ApiEndpoint.Setup}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationName: "Acme",
      domain: "acme.test",
      displayName: "Ada Admin",
      address: "ada@acme.test",
      password: "correct-horse"
    })
  });
  check(setup.status === 201, `setup status ${setup.status}`);
  const home = await fetch(`http://127.0.0.1:${webPort}/`);
  const html = await home.text();
  check(html.includes("Open Mail Server"), "home page name");
  check(html.includes("styles/base.css"), "home page loads the design stylesheet");

  const stylesheet = await fetch(`http://127.0.0.1:${webPort}/styles/base.css`);
  const css = await stylesheet.text();
  check(css.includes("--color-primary: #2563eb"), "primary color token");

  const smtp = await new Promise<net.Socket>((resolve) => {
    const socket = net.connect(port("SMTP", "Plain and STARTTLS"), "127.0.0.1", () => resolve(socket));
  });
  let greeting = await readResponse(smtp);
  check(greeting.startsWith("220 acme.test "), `smtp greeting ${greeting}`);
  smtp.write("EHLO acme.test\r\n");
  const ehlo = await readResponse(smtp);
  check(ehlo.startsWith("250-acme.test"), `smtp greeting name ${ehlo}`);
  check(ehlo.includes("STARTTLS"), "smtp advertises STARTTLS");
  const quotedName = parseRawMessage(Buffer.from('From: "Ada Nguyen" <ada@acme.test>\r\nTo: ada@acme.test\r\nSubject: Name\r\n\r\nHi\r\n'));
  check(quotedName.fromName === "Ada Nguyen", `display name ${quotedName.fromName}`);
  smtp.write("MAIL FROM:<outside@example.test>\r\n");
  await readResponse(smtp);
  smtp.write("RCPT TO:<ada@acme.test>\r\n");
  await readResponse(smtp);
  smtp.write("DATA\r\n");
  const dataReady = await readResponse(smtp);
  check(dataReady.startsWith("354"), `data response ${dataReady}`);
  smtp.write("From: Outside <outside@example.test>\r\nTo: ada@acme.test\r\nSubject: Protocol check\r\nMessage-ID: <protocol@example.test>\r\n\r\nHello from the test.\r\n.\r\n");
  const accepted = await readResponse(smtp);
  check(accepted.startsWith("250"), `accepted ${accepted}`);
  smtp.end();

  const securePort = port("SMTP", "TLS");
  const secure = tls.connect({ host: "127.0.0.1", port: securePort, rejectUnauthorized: false, minVersion: "TLSv1.2" });
  await new Promise<void>((resolve, reject) => {
    secure.once("secure", () => resolve());
    secure.once("error", reject);
  });
  await readResponse(secure);
  secure.write("EHLO acme.test\r\n");
  const secureEhlo = await readResponse(secure);
  check(secureEhlo.includes("AUTH PLAIN"), "secure smtp advertises authentication");
  const token = Buffer.from("\u0000ada@acme.test\u0000correct-horse").toString("base64");
  secure.write(`AUTH PLAIN ${token}\r\n`);
  const authenticated = await readResponse(secure);
  check(authenticated.startsWith("235"), `authentication ${authenticated}`);
  secure.write("MAIL FROM:<ada@acme.test>\r\n");
  await readResponse(secure);
  secure.write("RCPT TO:<person@example.test>\r\n");
  await readResponse(secure);
  secure.write("DATA\r\n");
  await readResponse(secure);
  secure.write("From: Ada <ada@acme.test>\r\nTo: person@example.test\r\nSubject: Outbound\r\n\r\nLeaving the building.\r\n.\r\n");
  const relayed = await readResponse(secure);
  check(relayed.startsWith("250"), `relay ${relayed}`);
  secure.end();
  await new Promise((resolve) => setTimeout(resolve, 200));
  check(sinkMessages.some((message) => message.includes("Leaving the building.")), "outbound message reached the other mail server");

  const imap = await new Promise<net.Socket>((resolve) => {
    const socket = net.connect(port("IMAP", "Plain and STARTTLS"), "127.0.0.1", () => resolve(socket));
  });
  const imapGreeting = await readResponse(imap);
  check(imapGreeting.includes("IMAP4rev1"), "imap greeting");
  imap.write("a1 LOGIN ada@acme.test correct-horse\r\n");
  const loggedIn = await readResponse(imap, { tag: "a1" });
  check(loggedIn.includes("OK"), `imap login ${loggedIn}`);
  imap.write("a2 SELECT INBOX\r\n");
  const selected = await readResponse(imap, { tag: "a2" });
  check(selected.includes("EXISTS"), `imap select ${selected}`);
  imap.write("a3 SEARCH SUBJECT Protocol\r\n");
  const search = await readResponse(imap, { tag: "a3" });
  check(search.includes("* SEARCH"), `imap search ${search}`);
  imap.write("a4 FETCH 1 (FLAGS ENVELOPE)\r\n");
  const fetched = await readResponse(imap, { tag: "a4" });
  check(fetched.includes("Protocol check") || fetched.includes("ENVELOPE"), `imap fetch ${fetched}`);
  imap.write("a5 IDLE\r\n");
  const idling = await readResponse(imap);
  check(idling.includes("idling"), `imap idle ${idling}`);
  imap.write("DONE\r\n");
  const idleDone = await readResponse(imap, { tag: "a5" });
  check(idleDone.includes("IDLE completed"), `imap idle done ${idleDone}`);
  imap.write("a6 LOGOUT\r\n");
  imap.end();

  const pop = await new Promise<net.Socket>((resolve) => {
    const socket = net.connect(port("POP3", "Plain and STLS"), "127.0.0.1", () => resolve(socket));
  });
  await readResponse(pop);
  pop.write("USER ada@acme.test\r\n");
  await readResponse(pop);
  pop.write("PASS correct-horse\r\n");
  const popSignedIn = await readResponse(pop);
  check(popSignedIn.startsWith("+OK"), `pop sign in ${popSignedIn}`);
  pop.write("RETR 1\r\n");
  const retrieved = await readResponse(pop, { dotTerminated: true });
  check(retrieved.includes("Hello from the test."), `pop retrieve ${retrieved}`);
  pop.write("QUIT\r\n");
  pop.end();

  const sessionCookie = (setup.headers.get("set-cookie") || "").split(";")[0];
  const logs = await fetch(`http://127.0.0.1:${webPort}${ApiEndpoint.Activity}?search=Protocol`, {
    headers: { Cookie: sessionCookie }
  });
  const logPayload = (await logs.json()) as { events?: Array<{ subject: string }> };
  check(logs.status === 200 && logPayload.events?.some((event) => event.subject.includes("Protocol")), `activity log ${logs.status}`);
} catch (error) {
  console.error(error);
  failures.push((error as Error).message);
} finally {
  await running.stop();
  await new Promise<void>((resolve) => sink.close(() => resolve()));
  await rm(storageDirectory, { recursive: true, force: true });
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Open Mail Server protocol and console checks passed.");

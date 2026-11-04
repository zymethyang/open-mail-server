import net from "node:net";
import tls from "node:tls";
import type { Configuration } from "../configuration/index.js";
import { oneLine } from "../text/index.js";
import { extractEnvelopeAddress, isValidAddress, normalizeAddress } from "../text/index.js";
import type { DeliveryService } from "../delivery/index.js";
import type { AccountRepository } from "../account/index.js";
import type { ActivityLogger } from "../activity/index.js";
import type { ServerCertificate } from "../certificate/index.js";
import type { SignInGuard } from "../signIn/interfaces/signInGuard.js";
import { ActivityAction } from "../activity/enums/activityAction.js";
import { ActivityResult } from "../activity/enums/activityResult.js";
import { MailProtocol } from "../protocol/enums/mailProtocol.js";
import { listen } from "../protocol/utils/listen.js";
import { createProtocolReader } from "../protocol/index.js";
import { secureOptions, upgradeToTls } from "../protocol/utils/transportSecurity.js";
import type { SmtpEndpoint } from "./interfaces/smtpEndpoint.js";
export type { SmtpEndpoint };

interface SmtpSessionState {
  secure: boolean;
  greeted: boolean;
  mailAccepted: boolean;
  accountAddress: string;
  senderAddress: string;
  recipients: string[];
  authenticationStep: "" | "login-username" | "login-password" | "plain";
  authenticationUsername: string;
  remoteAddress: string;
}

export class SmtpServer {
  constructor(private readonly input: {
    configuration: Configuration;
    endpoint: SmtpEndpoint;
    certificate: ServerCertificate;
    accountRepository: AccountRepository;
    deliveryService: DeliveryService;
    signInGuard: SignInGuard;
    activityLogger: ActivityLogger;
    productName: string;
    serverName(): Promise<string>;
  }) {}

  async start(): Promise<{ server: net.Server; port: number }> {
    const input = this.input;
    const handleConnection = (socket: net.Socket) => {
    void openConnection(socket).catch(() => socket.destroy());
  };

  async function openConnection(socket: net.Socket): Promise<void> {
    const serverName = oneLine(await input.serverName(), 253) || "localhost";
    socket.setTimeout(2 * 60 * 1000, () => socket.destroy());
    const reader = createProtocolReader({
      acceptLiterals: false,
      maximumDataBytes: input.configuration.maximumMessageBytes
    });
    const session: SmtpSessionState = {
      secure: input.endpoint.secure,
      greeted: false,
      mailAccepted: false,
      accountAddress: "",
      senderAddress: "",
      recipients: [],
      authenticationStep: "",
      authenticationUsername: "",
      remoteAddress: socket.remoteAddress || ""
    };
    reader.onLine = (line) => handleLine(line);
    reader.onDataBlock = (block) => acceptMessage(block);
    reader.attach(socket);
    reader.send(`220 ${serverName} ESMTP ${input.productName} ready\r\n`);

    function capabilities(): string {
      const lines = [`250-${serverName}`, "250-PIPELINING", "250-8BITMIME", "250-SMTPUTF8", `250-SIZE ${input.configuration.maximumMessageBytes}`];
      if (!session.secure) {
        lines.push("250-STARTTLS");
      }
      if (session.secure) {
        lines.push("250-AUTH PLAIN LOGIN");
      }
      lines.push("250 HELP");
      const lastLine = lines.pop() || "250 HELP";
      lines.push(lastLine.startsWith("250-") ? lastLine.replace("250-", "250 ") : lastLine);
      return `${lines.join("\r\n")}\r\n`;
    }

    function resetTransaction(): void {
      session.mailAccepted = false;
      session.senderAddress = "";
      session.recipients = [];
    }

    async function signIn(username: string, password: string): Promise<void> {
      const key = `sign-in:${normalizeAddress(username) || username}`;
      const blocked = input.signInGuard.rejectionMessage(key);
      if (blocked) {
        reader.send(`454 4.7.0 ${blocked}\r\n`);
        return;
      }
      const account = await input.accountRepository.verifyCredentials(username, password);
      if (!account) {
        input.signInGuard.recordFailure(key);
        await input.activityLogger.record({
          protocol: MailProtocol.Smtp,
          action: ActivityAction.SignIn,
          remoteAddress: session.remoteAddress,
          mailboxAddress: normalizeAddress(username),
          senderAddress: "",
          recipientAddresses: [],
          subject: "",
          byteCount: 0,
          result: ActivityResult.Rejected,
          detail: "invalid credentials"
        });
        reader.send("535 5.7.8 Invalid credentials\r\n");
        return;
      }
      input.signInGuard.recordSuccess(key);
      session.accountAddress = account.address;
      reader.send("235 2.7.0 Authentication succeeded\r\n");
    }

    async function handleLine(line: string): Promise<void | "collect-data"> {
      if (session.authenticationStep === "login-username") {
        session.authenticationUsername = Buffer.from(line.trim(), "base64").toString("utf8");
        session.authenticationStep = "login-password";
        reader.send("334 UGFzc3dvcmQ6\r\n");
        return;
      }
      if (session.authenticationStep === "login-password") {
        const password = Buffer.from(line.trim(), "base64").toString("utf8");
        session.authenticationStep = "";
        await signIn(session.authenticationUsername, password);
        return;
      }
      if (session.authenticationStep === "plain") {
        session.authenticationStep = "";
        const decoded = Buffer.from(line.trim(), "base64").toString("utf8").split("\u0000");
        await signIn(decoded[1] || "", decoded[2] || "");
        return;
      }

      const separator = line.indexOf(" ");
      const command = (separator === -1 ? line : line.slice(0, separator)).toUpperCase();
      const argument = separator === -1 ? "" : line.slice(separator + 1);

      if (command === "EHLO" || command === "HELO") {
        if (!argument.trim()) {
          reader.send("501 5.5.4 Domain name required\r\n");
          return;
        }
        session.greeted = true;
        resetTransaction();
        if (command === "HELO") {
          reader.send(`250 ${input.productName} greets ${oneLine(argument, 200)}\r\n`);
          return;
        }
        reader.send(capabilities());
        return;
      }
      if (command === "NOOP") {
        reader.send("250 2.0.0 OK\r\n");
        return;
      }
      if (command === "RSET") {
        resetTransaction();
        reader.send("250 2.0.0 Reset\r\n");
        return;
      }
      if (command === "QUIT") {
        reader.send(`221 2.0.0 ${input.productName} closing\r\n`);
        reader.close();
        return;
      }
      if (command === "HELP") {
        reader.send("214 2.0.0 Commands: EHLO HELO STARTTLS AUTH MAIL RCPT DATA RSET NOOP QUIT VRFY HELP\r\n");
        return;
      }
      if (command === "VRFY" || command === "EXPN") {
        reader.send("252 2.5.2 Cannot verify the address\r\n");
        return;
      }
      if (command === "STARTTLS") {
        if (session.secure) {
          reader.send("503 5.5.1 TLS is already active\r\n");
          return;
        }
        if (session.accountAddress) {
          reader.send("503 5.5.1 Sign in is already complete\r\n");
          return;
        }
        reader.send("220 2.0.0 Ready to start TLS\r\n");
        const secureSocket = await upgradeToTls(socket, input.certificate);
        reader.attach(secureSocket);
        session.secure = true;
        session.greeted = false;
        resetTransaction();
        return;
      }
      if (!session.greeted) {
        reader.send("503 5.5.1 Say EHLO first\r\n");
        return;
      }
      if (command === "AUTH") {
        if (!session.secure) {
          reader.send("530 5.7.0 Authentication requires TLS\r\n");
          return;
        }
        if (session.accountAddress) {
          reader.send("503 5.5.1 Already signed in\r\n");
          return;
        }
        if (session.senderAddress) {
          reader.send("503 5.5.1 Finish or reset the current message first\r\n");
          return;
        }
        const [mechanism, initial] = argument.split(" ");
        const name = (mechanism || "").toUpperCase();
        if (name === "PLAIN") {
          if (!initial) {
            session.authenticationStep = "plain";
            reader.send("334 \r\n");
            return;
          }
          const decoded = Buffer.from(initial, "base64").toString("utf8").split("\u0000");
          await signIn(decoded[1] || "", decoded[2] || "");
          return;
        }
        if (name === "LOGIN") {
          session.authenticationStep = "login-username";
          reader.send("334 VXNlcm5hbWU6\r\n");
          return;
        }
        reader.send("504 5.7.4 Authentication mechanism is not supported\r\n");
        return;
      }
      if (command === "MAIL") {
        if (!/^FROM:/i.test(argument.trim())) {
          reader.send("501 5.5.4 MAIL FROM is required\r\n");
          return;
        }
        const from = extractEnvelopeAddress(argument.replace(/^FROM:/i, ""));
        if (from && !isValidAddress(from)) {
          reader.send("501 5.1.7 Sender address is invalid\r\n");
          return;
        }
        if (input.endpoint.requireAuthentication && !session.accountAddress) {
          reader.send("530 5.7.0 Authentication required\r\n");
          return;
        }
        session.mailAccepted = true;
        session.senderAddress = from;
        session.recipients = [];
        reader.send("250 2.1.0 Sender accepted\r\n");
        return;
      }
      if (command === "RCPT") {
        if (!session.mailAccepted) {
          reader.send("503 5.5.1 Say MAIL first\r\n");
          return;
        }
        if (!/^TO:/i.test(argument.trim())) {
          reader.send("501 5.5.4 RCPT TO is required\r\n");
          return;
        }
        const recipient = extractEnvelopeAddress(argument.replace(/^TO:/i, ""));
        if (!isValidAddress(recipient)) {
          reader.send("550 5.1.1 Recipient rejected\r\n");
          return;
        }
        session.recipients.push(recipient);
        reader.send("250 2.1.5 Recipient accepted\r\n");
        return;
      }
      if (command === "DATA") {
        if (!session.mailAccepted) {
          reader.send("503 5.5.1 Say MAIL first\r\n");
          return;
        }
        if (!session.recipients.length) {
          reader.send("503 5.5.1 Say RCPT first\r\n");
          return;
        }
        reader.send("354 End the message with a line containing only a period\r\n");
        return "collect-data";
      }
      reader.send("500 5.5.2 Command not recognized\r\n");
    }

    async function acceptMessage(block: Buffer): Promise<void> {
      try {
        await input.deliveryService.deliver({
          fromAddress: session.senderAddress,
          recipientAddresses: session.recipients,
          rawBuffer: block,
          authenticatedAddress: session.accountAddress,
          remoteAddress: session.remoteAddress,
          protocol: MailProtocol.Smtp
        });
        reader.send("250 2.0.0 Message accepted\r\n");
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode || 450;
        const detail = oneLine((error as Error).message, 300);
        await input.activityLogger.record({
          protocol: MailProtocol.Smtp,
          action: ActivityAction.Reject,
          remoteAddress: session.remoteAddress,
          mailboxAddress: session.accountAddress,
          senderAddress: session.senderAddress,
          recipientAddresses: [...session.recipients],
          subject: "",
          byteCount: block.length,
          result: ActivityResult.Rejected,
          detail
        });
        reader.send(`${statusCode} ${detail}\r\n`);
      } finally {
        resetTransaction();
      }
    }
  };

  const server = input.endpoint.secure
    ? tls.createServer(secureOptions(input.certificate), handleConnection)
    : net.createServer(handleConnection);
  const port = await listen(server, input.endpoint.port, input.configuration.host);
    return { server, port };
  }
}

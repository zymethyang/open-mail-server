import net from "node:net";
import tls from "node:tls";
import { ServerPort } from "../../configuration/enums/serverPort.js";

export function listen(server: net.Server | tls.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("listening", handleListening);
      server.close(() => undefined);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      server.on("error", (error) => {
        console.error(`Listener on port ${port} stopped: ${error.message}`);
      });
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, host);
  });
}

export async function listenWhenPortIsFree<T>(
  start: () => Promise<T>,
  stopping: () => boolean,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<T> {
  for (;;) {
    if (stopping()) {
      throw Object.assign(new Error("The listener stopped"), { code: "STOPPING" });
    }
    try {
      return await start();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
        throw error;
      }
      await wait(300);
    }
  }
}

export function describeListenError(error: NodeJS.ErrnoException): string {
  if (error.code === "EADDRINUSE") {
    return "port is already in use";
  }
  if (error.code === "EACCES" || error.code === "EPERM") {
    return `permission denied. Port ${ServerPort.Smtp}, ${ServerPort.Web}, ${ServerPort.SmtpSecure}, ${ServerPort.Imap}, and ${ServerPort.ImapSecure} may require an administrator on Windows`;
  }
  return error.message || "could not start";
}

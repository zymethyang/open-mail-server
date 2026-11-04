import net from "node:net";
import tls from "node:tls";

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

export function describeListenError(error: NodeJS.ErrnoException): string {
  if (error.code === "EADDRINUSE") {
    return "port is already in use";
  }
  if (error.code === "EACCES" || error.code === "EPERM") {
    return "permission denied. Port 25, 465, 143, and 993 may require an administrator on Windows";
  }
  return error.message || "could not start";
}

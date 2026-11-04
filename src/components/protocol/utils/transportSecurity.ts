import net from "node:net";
import tls from "node:tls";
import type { ServerCertificate } from "../../certificate/index.js";

export function secureOptions(certificate: ServerCertificate): tls.TlsOptions {
  return {
    key: certificate.privateKey,
    cert: certificate.certificate,
    minVersion: "TLSv1.2"
  };
}

export function upgradeToTls(socket: net.Socket, certificate: ServerCertificate): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secureSocket = new tls.TLSSocket(socket, {
      isServer: true,
      secureContext: tls.createSecureContext(secureOptions(certificate))
    });
    const fail = (error: Error) => {
      secureSocket.destroy();
      reject(error);
    };
    secureSocket.once("secure", () => {
      secureSocket.off("error", fail);
      resolve(secureSocket);
    });
    secureSocket.once("error", fail);
  });
}

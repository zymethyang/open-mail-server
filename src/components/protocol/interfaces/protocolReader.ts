import type net from "node:net";

export type LineResult = void | "collect-data" | Promise<void | "collect-data">;

export interface ProtocolReader {
  send(data: string | Buffer): void;
  close(): void;
  attach(socket: net.Socket): void;
  onLine: (line: string) => LineResult;
  onLiteral: (line: string, literal: Buffer) => Promise<void> | void;
  onLiteralRequest: (line: string) => void;
  onDataBlock: (block: Buffer) => Promise<void> | void;
  onClose: () => void;
  readonly socket: net.Socket | null;
}

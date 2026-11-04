export type { OutboundAttachment } from "./interfaces/outboundAttachment.js";
export {
  buildEnvelope,
  createMessageIdentifier,
  createRawMessage,
  createSnippet,
  createStoredMessage,
  encodeHeaderValue,
  filterHeaderFields,
  formatInternalDate,
  formatRfc5322Date,
  imapAddressGroup,
  parseRawMessage,
  quoteImap,
  rawBufferFromMessage,
  sanitizeMessageHtml,
  splitHeaderAndBody
} from "./utils/mimeMessage.js";

import type { MailFolder, MessageRecord } from "../../message/interfaces/mailTypes.js";

export interface SelectedFolder {
  folder: MailFolder;
  readOnly: boolean;
  messages: MessageRecord[];
}

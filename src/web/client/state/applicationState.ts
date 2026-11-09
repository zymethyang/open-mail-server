import { MailFolderName } from "../enums/mailFolderName.js";
import type { Bootstrap, ComposeDraft, ComposerAttachment } from "../interfaces/models.js";

export class ApplicationState {
  bootstrap: Bootstrap | null = null;
  folderName: string = MailFolderName.Inbox;
  messageIdentifier = "";
  compose: ComposeDraft | null = null;
  composeAttachments: ComposerAttachment[] = [];
  userQuery = "";
  userStatus = "";
  composerRange: Range | null = null;

  clearSessionView(): void {
    this.folderName = MailFolderName.Inbox;
    this.messageIdentifier = "";
    this.compose = null;
    this.composeAttachments = [];
    this.userQuery = "";
    this.userStatus = "";
    this.composerRange = null;
    document.querySelector("#compose-window")?.remove();
  }
}

export const applicationState = new ApplicationState();

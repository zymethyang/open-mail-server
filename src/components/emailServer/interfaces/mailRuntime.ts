import type { AccountRepository } from "../../account/interfaces/accountRepository.js";
import type { ActivityLogger } from "../../activity/interfaces/activityLogger.js";
import type { ServerCertificate } from "../../certificate/interfaces/serverCertificate.js";
import type { Configuration } from "../../configuration/interfaces/configuration.js";
import type { DeliveryService } from "../../delivery/interfaces/delivery.js";
import type { MailboxEvents } from "../../mailboxEvents/interfaces/mailboxEvents.js";
import type { MessageRepository } from "../../message/interfaces/messageRepository.js";
import type { OrganizationRepository } from "../../organization/interfaces/organizationRepository.js";
import type { SessionRepository } from "../../session/interfaces/sessionRepository.js";
import type { SettingsRepository } from "../../settings/interfaces/settings.js";
import type { SignInGuard } from "../../signIn/interfaces/signInGuard.js";

export interface MailRuntime {
  configuration: Configuration;
  certificate: ServerCertificate;
  accountRepository: AccountRepository;
  organizationRepository: OrganizationRepository;
  messageRepository: MessageRepository;
  sessionRepository: SessionRepository;
  activityLogger: ActivityLogger;
  settingsRepository: SettingsRepository;
  signInGuard: SignInGuard;
  deliveryService: DeliveryService;
  mailboxEvents: MailboxEvents;
  serverName(): Promise<string>;
}

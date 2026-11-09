import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { MessageRepository as MessageRepositoryContract } from "./interfaces/messageRepository.js";
import type { MailboxState, MailFolder, MessageDraft, MessageRecord } from "./interfaces/mailTypes.js";
import { permanentFolders } from "./constants/permanentFolders.js";
import { findFolder, isSafeStorageName, storageNameFromDisplay } from "./utils/folder.js";
import type { MailboxEvents } from "../mailboxEvents/interfaces/mailboxEvents.js";
import { normalizeAddress } from "../text/index.js";
import { withLock } from "../jsonFile/index.js";
import { readJson, writeJson } from "../jsonFile/index.js";

function createIdentifier(): string {
  return randomBytes(12).toString("hex");
}

function folderError(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 404 });
}

function createMessageRepository(storageDirectory: string, events: MailboxEvents): MessageRepositoryContract {
  function mailboxDirectory(address: string): string {
    return path.join(storageDirectory, "mailboxes", normalizeAddress(address));
  }

  function folderDirectory(address: string, storageName: string): string {
    return path.join(mailboxDirectory(address), storageName);
  }

  function statePath(address: string): string {
    return path.join(mailboxDirectory(address), "mailbox.json");
  }

  function lockName(address: string): string {
    return `mailbox:${normalizeAddress(address)}`;
  }

  async function ensureMailboxUnlocked(address: string): Promise<void> {
    const directory = mailboxDirectory(address);
    await mkdir(directory, { recursive: true });
    let state: MailboxState;
    try {
      state = await readJson<MailboxState>(statePath(address));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      state = {
        validity: 1,
        nextUniqueIdentifier: 1,
        folders: permanentFolders.map((folder) => ({ ...folder })),
        subscriptions: permanentFolders.map((folder) => folder.storageName)
      };
      await writeJson(statePath(address), state);
    }
    if (!Array.isArray(state.folders) || state.folders.length === 0) {
      state.folders = permanentFolders.map((folder) => ({ ...folder }));
      state.subscriptions = state.subscriptions || permanentFolders.map((folder) => folder.storageName);
      await writeJson(statePath(address), state);
    }
    state.subscriptions = Array.isArray(state.subscriptions) ? state.subscriptions : [];
    let addedPermanentFolder = false;
    for (const folder of permanentFolders) {
      if (state.folders.some((item) => item.storageName === folder.storageName)) {
        continue;
      }
      state.folders.push({ ...folder });
      if (!state.subscriptions.includes(folder.storageName)) {
        state.subscriptions.push(folder.storageName);
      }
      addedPermanentFolder = true;
    }
    if (addedPermanentFolder) {
      await writeJson(statePath(address), state);
    }
    for (const folder of state.folders) {
      if (isSafeStorageName(folder.storageName)) {
        await mkdir(folderDirectory(address, folder.storageName), { recursive: true });
      }
    }
  }

  async function readState(address: string): Promise<MailboxState> {
    await ensureMailboxUnlocked(address);
    return readJson<MailboxState>(statePath(address));
  }

  function requireFolder(state: MailboxState, folderName: string): MailFolder {
    const folder = findFolder(state.folders, folderName);
    if (!folder || !isSafeStorageName(folder.storageName)) {
      folderError("Unknown folder");
    }
    return folder;
  }

  async function listRecords(address: string, storageName: string): Promise<MessageRecord[]> {
    const directory = folderDirectory(address, storageName);
    await mkdir(directory, { recursive: true });
    const fileNames = await readdir(directory);
    const records: MessageRecord[] = [];
    for (const fileName of fileNames) {
      if (!fileName.endsWith(".json")) {
        continue;
      }
      try {
        const record = await readJson<MessageRecord>(path.join(directory, fileName));
        records.push(record);
      } catch (error) {
        console.error(`Skipped unreadable message ${fileName}: ${(error as Error).message}`);
      }
    }
    records.sort((left, right) => left.uniqueIdentifier - right.uniqueIdentifier);
    return records;
  }

  async function writeRecord(address: string, storageName: string, record: MessageRecord): Promise<void> {
    const filePath = path.join(folderDirectory(address, storageName), `${record.identifier}.json`);
    await writeJson(filePath, record);
  }

  return {
    async ensureMailbox(address) {
      await withLock(lockName(address), () => ensureMailboxUnlocked(address));
    },

    async mailboxState(address) {
      return withLock(lockName(address), () => readState(address));
    },

    async listFolders(address) {
      return withLock(lockName(address), async () => {
        const state = await readState(address);
        return state.folders;
      });
    },

    async listMessages(address, folderName) {
      return withLock(lockName(address), async () => {
        const state = await readState(address);
        const folder = requireFolder(state, folderName);
        return listRecords(address, folder.storageName);
      });
    },

    async readMessage(address, folderName, identifier) {
      return withLock(lockName(address), async () => {
        const state = await readState(address);
        const folder = requireFolder(state, folderName);
        if (!/^[a-f0-9]{24}$/.test(identifier)) {
          folderError("Message not found");
        }
        try {
          return await readJson<MessageRecord>(path.join(folderDirectory(address, folder.storageName), `${identifier}.json`));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            folderError("Message not found");
          }
          throw error;
        }
      });
    },

    async appendMessage(address, folderName, message) {
      const record = await withLock(lockName(address), async () => {
        const state = await readState(address);
        const folder = requireFolder(state, folderName);
        const uniqueIdentifier = state.nextUniqueIdentifier;
        state.nextUniqueIdentifier += 1;
        await writeJson(statePath(address), state);
        const stored: MessageRecord = {
          ...message,
          attachments: message.attachments || [],
          identifier: createIdentifier(),
          uniqueIdentifier,
          folderName: folder.storageName
        };
        await writeRecord(address, folder.storageName, stored);
        return stored;
      });
      events.publish({ address: normalizeAddress(address), folderStorageName: record.folderName });
      return record;
    },

    async updateMessage(address, folderName, identifier, changes) {
      const next = await withLock(lockName(address), async () => {
        const state = await readState(address);
        const folder = requireFolder(state, folderName);
        if (!/^[a-f0-9]{24}$/.test(identifier)) {
          folderError("Message not found");
        }
        const filePath = path.join(folderDirectory(address, folder.storageName), `${identifier}.json`);
        let current: MessageRecord;
        try {
          current = await readJson<MessageRecord>(filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            folderError("Message not found");
          }
          throw error;
        }
        const updated: MessageRecord = {
          ...current,
          ...changes,
          identifier: current.identifier,
          uniqueIdentifier: current.uniqueIdentifier,
          folderName: folder.storageName,
          rawEncoded: current.rawEncoded,
          rawSize: current.rawSize
        };
        await writeRecord(address, folder.storageName, updated);
        return updated;
      });
      events.publish({ address: normalizeAddress(address), folderStorageName: next.folderName });
      return next;
    },

    async removeMessages(address, folderName, identifiers) {
      const folderStorageName = await withLock(lockName(address), async () => {
        const state = await readState(address);
        const folder = requireFolder(state, folderName);
        for (const identifier of identifiers) {
          if (!/^[a-f0-9]{24}$/.test(identifier)) {
            continue;
          }
          await rm(path.join(folderDirectory(address, folder.storageName), `${identifier}.json`), { force: true });
        }
        return folder.storageName;
      });
      events.publish({ address: normalizeAddress(address), folderStorageName });
    },

    async moveMessage(address, fromFolderName, toFolderName, identifier) {
      const moved = await withLock(lockName(address), async () => {
        const state = await readState(address);
        const fromFolder = requireFolder(state, fromFolderName);
        const toFolder = requireFolder(state, toFolderName);
        if (!/^[a-f0-9]{24}$/.test(identifier)) {
          folderError("Message not found");
        }
        const sourcePath = path.join(folderDirectory(address, fromFolder.storageName), `${identifier}.json`);
        let current: MessageRecord;
        try {
          current = await readJson<MessageRecord>(sourcePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            folderError("Message not found");
          }
          throw error;
        }
        const uniqueIdentifier = state.nextUniqueIdentifier;
        state.nextUniqueIdentifier += 1;
        await writeJson(statePath(address), state);
        const next: MessageRecord = {
          ...current,
          uniqueIdentifier,
          folderName: toFolder.storageName,
          deleted: false
        };
        await writeRecord(address, toFolder.storageName, next);
        await rm(sourcePath, { force: true });
        return { message: next, sourceFolderName: fromFolder.storageName };
      });
      events.publish({ address: normalizeAddress(address), folderStorageName: moved.sourceFolderName });
      if (moved.sourceFolderName !== moved.message.folderName) {
        events.publish({ address: normalizeAddress(address), folderStorageName: moved.message.folderName });
      }
      return moved.message;
    },

    async createFolder(address, displayName) {
      return withLock(lockName(address), async () => {
        const state = await readState(address);
        const storageName = storageNameFromDisplay(displayName);
        if (!isSafeStorageName(storageName) || findFolder(state.folders, displayName) || findFolder(state.folders, storageName)) {
          throw Object.assign(new Error("Folder name is not available"), { statusCode: 400 });
        }
        const folder: MailFolder = {
          storageName,
          displayName: displayName.trim().slice(0, 80),
          label: displayName.trim().slice(0, 80),
          permanent: false,
          specialUse: ""
        };
        state.folders.push(folder);
        state.subscriptions.push(storageName);
        await mkdir(folderDirectory(address, storageName), { recursive: true });
        await writeJson(statePath(address), state);
        return folder;
      });
    },

    async deleteFolder(address, displayName) {
      await withLock(lockName(address), async () => {
        const state = await readState(address);
        const folder = requireFolder(state, displayName);
        if (folder.permanent) {
          throw Object.assign(new Error("That folder cannot be deleted"), { statusCode: 400 });
        }
        state.folders = state.folders.filter((item) => item.storageName !== folder.storageName);
        state.subscriptions = state.subscriptions.filter((item) => item !== folder.storageName);
        await writeJson(statePath(address), state);
        await rm(folderDirectory(address, folder.storageName), { recursive: true, force: true });
      });
    },

    async renameFolder(address, displayName, nextDisplayName) {
      return withLock(lockName(address), async () => {
        const state = await readState(address);
        const folder = requireFolder(state, displayName);
        if (folder.permanent) {
          throw Object.assign(new Error("That folder cannot be renamed"), { statusCode: 400 });
        }
        const previousStorageName = folder.storageName;
        const nextStorageName = storageNameFromDisplay(nextDisplayName);
        if (!isSafeStorageName(nextStorageName) || (nextStorageName !== previousStorageName && findFolder(state.folders, nextStorageName))) {
          throw Object.assign(new Error("Folder name is not available"), { statusCode: 400 });
        }
        if (nextStorageName !== previousStorageName) {
          await rename(folderDirectory(address, previousStorageName), folderDirectory(address, nextStorageName));
        }
        folder.storageName = nextStorageName;
        folder.displayName = nextDisplayName.trim().slice(0, 80);
        folder.label = folder.displayName;
        state.subscriptions = state.subscriptions.map((item) => (item === previousStorageName ? nextStorageName : item));
        await writeJson(statePath(address), state);
        return folder;
      });
    },

    async setSubscription(address, displayName, subscribed) {
      await withLock(lockName(address), async () => {
        const state = await readState(address);
        const folder = requireFolder(state, displayName);
        const hasSubscription = state.subscriptions.includes(folder.storageName);
        if (subscribed && !hasSubscription) {
          state.subscriptions.push(folder.storageName);
        }
        if (!subscribed && hasSubscription) {
          state.subscriptions = state.subscriptions.filter((item) => item !== folder.storageName);
        }
        await writeJson(statePath(address), state);
      });
    }
  };
}

export class MessageRepository implements MessageRepositoryContract {
  private readonly repository: MessageRepositoryContract;

  constructor(storageDirectory: string, events: MailboxEvents) {
    this.repository = createMessageRepository(storageDirectory, events);
  }

  ensureMailbox(address: string) {
    return this.repository.ensureMailbox(address);
  }

  mailboxState(address: string) {
    return this.repository.mailboxState(address);
  }

  listFolders(address: string) {
    return this.repository.listFolders(address);
  }

  listMessages(address: string, folderName: string) {
    return this.repository.listMessages(address, folderName);
  }

  readMessage(address: string, folderName: string, identifier: string) {
    return this.repository.readMessage(address, folderName, identifier);
  }

  appendMessage(address: string, folderName: string, message: MessageDraft) {
    return this.repository.appendMessage(address, folderName, message);
  }

  updateMessage(address: string, folderName: string, identifier: string, changes: Partial<MessageDraft>) {
    return this.repository.updateMessage(address, folderName, identifier, changes);
  }

  removeMessages(address: string, folderName: string, identifiers: string[]) {
    return this.repository.removeMessages(address, folderName, identifiers);
  }

  moveMessage(address: string, fromFolderName: string, toFolderName: string, identifier: string) {
    return this.repository.moveMessage(address, fromFolderName, toFolderName, identifier);
  }

  createFolder(address: string, displayName: string) {
    return this.repository.createFolder(address, displayName);
  }

  deleteFolder(address: string, displayName: string) {
    return this.repository.deleteFolder(address, displayName);
  }

  renameFolder(address: string, displayName: string, nextDisplayName: string) {
    return this.repository.renameFolder(address, displayName, nextDisplayName);
  }

  setSubscription(address: string, displayName: string, subscribed: boolean) {
    return this.repository.setSubscription(address, displayName, subscribed);
  }
}

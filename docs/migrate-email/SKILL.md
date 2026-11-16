---
name: migrate-email
description: >-
  Migrates a single user's existing email into that same user's mailbox on
  Open Mail Server, using a backup file (Gmail/M365 .mbox export, Outlook
  PST/OST, or a zip of .eml files) or by reading directly from another server
  over IMAP or POP3. Asks for the target user, the source (file or IMAP/POP3
  host/username/password), and for each folder confirms overwrite vs skip. Use
  when the user asks to import, migrate, or move one person's mailbox from
  another provider or server into this Open Mail Server account.
---

# Migrate Email (single user)

Move one user's existing mail into that user's own mailbox on Open Mail Server. Follow this text. Do not add code to the repository. You are the operator of a mail client; you read the source mail and deliver it into the server over IMAP `APPEND`. The mail store, folders, and the storage key stay on the server — you never touch them.

This is a single-user feature. You migrate exactly one user, from one source account, into that same user's mailbox. You do not import another person's mail into someone else's mailbox.

## Ask first

Ask for, in order:

1. The **target user** — the full email address on this server whose mailbox the mail will land in. The person running this must own that mailbox. If they name a different mailbox than the one they are authenticated as, stop and ask.
2. The **source**, exactly one of:
   - A **backup file** on the user's machine: a Gmail/M365 `.mbox` export, an Outlook `.pst`/`.ost`, or a `.zip` of `.eml` files. Ask which one, and for its path.
   - A **live server**: the IMAP or POP3 host, port, username, and password of the other mail server. Ask which transport (IMAP or POP3) only when the user is unsure; prefer IMAP because it carries folders.
3. For a live server, ask whether to **include every folder** or only specific folders.

Ask for the source password only when it is needed to read the source. Use it only for that source connection.

Never write the source password into the repository, a dotenv file, a commit, or a log. Do not repeat it in the chat after it has been used. The same rule applies to the target user's password if one is supplied.

## Decide the route

- If the source is a **file**, use the **Import from file** route.
- If the source is a **live server over IMAP**, use the **Import from IMAP** route.
- If the source is a **live server over POP3**, use the **Import from POP3** route.

Before you start, connect once to the target mailbox over IMAP to confirm the target user's sign-in works on this server. If that fails, stop and tell the user the target account is not usable.

## Connect to this server

This server uses SSL/TLS. On the incoming server, the username is the full email address and the password is the mailbox password.

| Direction | Protocol | Host | Port | Security |
| --- | --- | --- | --- | --- |
| Incoming | IMAP | your mail hostname | 993 | SSL/TLS |
| Incoming | POP3 | your mail hostname | 995 | SSL/TLS |
| Outgoing | SMTP | your mail hostname | 465 | SSL/TLS |

Authenticate to the target mailbox with `LOGIN <full email address> <password>` over TLS. The username is always the full email address.

## Import from file

The user gives you a file path. Do not read the password or the file contents into the repository or a log.

1. **Identify the format.**
   - **`.mbox`**: one file per folder, or one file for the whole mailbox. Each message begins with `From ` on its own line and is separated from the next by a blank line. Gmail and Microsoft 365 "export to .mbox" produce this.
   - **`.pst`/`.ost`**: a Microsoft Outlook archive. You must extract it first — Outlook stores messages in a binary container. If you cannot read it on the user's machine, ask the user to re-save the needed folders as `.mbox` or `.eml` and continue with those. Do not guess at the binary layout.
   - **`.zip` of `.eml`**: unzip to a temporary directory, then treat each `.eml` as one message. The folder it was in becomes the destination folder.
2. **List what you will import.** Show the user a list of folders and the message count per folder, and ask which to import. Confirm the target mailbox before continuing.
3. **For each folder, ask overwrite vs skip.** The target mailbox may already hold mail. For every folder, ask the user: replace the folder's current messages, or keep existing and add new ones? Record the answer. Do not assume.
   - To **add** new messages, append each one and let the server deduplicate by `Message-ID`; skip a message whose `Message-ID` already exists in that folder.
   - To **replace**, clear the folder's messages first, then append.
4. **Append each message to the target folder** over IMAP `APPEND`, as the target user:
   - Use the folder's server-side name (the server keeps a flat set of folders per user; map the source folder to the closest existing folder on the target, or create it).
   - Preserve the original `Date:` as the received time, and keep the message's flags.
   - Preserve all headers and all attachments. Do not strip, re-encode, or truncate a message.
5. **Report.** After each folder, say how many messages were imported, how many were skipped as duplicates, and how many failed. Stop on a failure and show the error with the password removed.

A message is delivered by `APPEND` into the target user's own mailbox. You never call an admin API and never touch another user's mailbox or the storage key.

## Import from IMAP

The user gives you the source host, port, username, and password. Use the password only for that connection.

1. Connect to the **source** IMAP server with TLS.
2. List the source folders and ask the user which to import and the target folder for each.
3. **For each chosen folder, ask overwrite vs skip** in the target mailbox, as above.
4. For each message: read the full raw message (including all headers and attachments) from the source, then `APPEND` it to the target folder as the target user. Preserve the original date and flags.
5. If the user chose **skip** for a folder that already has mail, deduplicate by `Message-ID` and skip what already exists. If they chose **replace**, clear the target folder first.
6. **Report** per folder: imported, skipped, failed. Stop on a failure and show the error with the password removed.

## Import from POP3

POP3 reads only the source's single mailbox and does not carry folders.

1. Connect to the source POP3 server with TLS, as the source user.
2. List the messages and ask the user how many to import.
3. Ask where to put them in the target mailbox (one folder), and **overwrite vs skip**.
4. Read each message in full, then `APPEND` it to the target folder as the target user. Preserve the original date.
5. **Report** imported, skipped, failed. Stop on a failure and show the error with the password removed.

## When it finishes

Tell the user the mail is in their mailbox on this server. They can open it in the web console or a mail app. If any message failed, list the count and the first error (password removed) and stop there.

When a step fails, show the error with the password removed, then stop. Do not retry a failed message more than once, and do not write credentials to any file.

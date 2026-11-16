# Security policy

Open Mail Server stores mail, mailbox passwords, and the encryption key that protects them. We take security reports seriously.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately:

- Email: zymethyang@gmail.com
- Include the version or commit, and the smallest steps to reproduce.

We aim to acknowledge a valid report within three business days. Please allow a reasonable window for a fix before public disclosure.

## Scope

The web console, SMTP, IMAP, POP3, mail authentication (SPF, DKIM, DMARC), the Let's Encrypt flow, the storage encryption key, and any code that handles mailbox passwords or stored mail.

## Supported versions

The current release and the one immediately before it.

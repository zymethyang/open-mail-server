---
name: install-open-mail-server
description: >-
  Installs Open Mail Server on a Linux VPS over SSH. Asks for the server
  host, username, and password, installs Docker when it is missing, copies
  this project and its Compose file, and starts the container. Use when the
  user asks to install, deploy, or set up Open Mail Server on a VPS or remote
  server.
---

# Install Open Mail Server

Install this repository on a Linux server the user administers. Follow this text. Do not add an install script to the repository.

## Ask first

Ask for the server host, the SSH username, and the SSH password. Ask for the SSH port only when it is not 22.

Stop when the user does not want that password used for this install. Use the password only for this SSH session.

Never write the password into the repository, the Compose file, a dotenv file, a commit, or a log. Do not repeat it in the chat after it has been used.

The remote account must be able to run sudo, unless it is already root.

## Install

1. Connect to the server with SSH.
2. If `docker compose version` fails, install Docker Engine and the Compose plugin, then start Docker.
3. Copy this project to `~/email-server` on the server. Leave out `data`, `node_modules`, `dist`, and `.git`, so an existing mail store stays in place. The copy includes `docker-compose.yml`, the Dockerfile, and the source.
4. On the server, from that directory, create `data` and give it to user id 1000. That is the account inside the container.
5. Run `docker compose up -d --build`.
6. When a firewall is active, allow TCP ports 25, 465, 587, 143, 993, 110, 995, and 443.

## When it finishes

Tell the user to open `https://<host>`. The browser warns because the certificate is self-signed. The first visit creates the company and the administrator account.

When a step fails, show the error with the password removed, then stop.

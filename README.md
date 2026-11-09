# Open Mail Server

Forget spending hundreds of dollars for your company email. This open-source project lets you run that mail yourself. Send it, receive it, and read it on the web, Android, and iOS.

![Open Mail Server web console](docs/web-interface.gif)

## How to start

There are two ways to install.

### Automate by AI

The install steps are in [docs/install-open-mail-server/SKILL.md](docs/install-open-mail-server/SKILL.md). Open this repository with AI and ask it to install Open Mail Server on your VPS. It asks for the VPS host, username, and password, then connects to that server. If Docker is missing, it installs Docker. It then writes the Compose file, copies this project, and starts the container.

The account you give it must be one you administer. The password is used only for that connection.

### With Docker Compose

From a copy of this project, save the following as `docker-compose.yml`. The repository already includes this file. `NET_BIND_SERVICE` lets the container listen on the mail ports without running as root.

```yaml
services:
  email-server:
    image: zymethyang/open-mail-server:v1.0.0
    restart: unless-stopped
    cap_add:
      - NET_BIND_SERVICE
    ports:
      - "25:25"
      - "465:465"
      - "587:587"
      - "143:143"
      - "993:993"
      - "110:110"
      - "995:995"
      - "443:443"
    volumes:
      - ./data:/opt/email-server/data
```

Start it from that directory. Compose pulls the published image and does not build one.

```bash
docker compose up -d
```

The mail store on the host is `./data`, mounted at `/opt/email-server/data` in the container. Keep `data/storage-key` with that directory. Stored mail can be opened only when that 32-byte file is present.

Open `https://your-server`. The certificate is self-signed, so the browser asks you to continue. The first visit creates the company and the administrator account. Enter the company domain, the public IP address of this server, and the administrator email on that page. DNS records and the port check use that address, and DMARC reports go to that email.

## How to connect

Use SSL/TLS for phone and tablet mail. The username is the full email address on both incoming and outgoing servers. The phone warns about the certificate until you upload a trusted one. That is covered in the FAQ.

| Direction | Protocol | Host | Port | Security |
| --- | --- | --- | --- | --- |
| Incoming | IMAP | your mail hostname | 993 | SSL/TLS |
| Incoming | POP3 | your mail hostname | 995 | SSL/TLS |
| Outgoing | SMTP | your mail hostname | 465 | SSL/TLS |

### Web

Sign in at `https://your-server`. Open **My mailbox** to send and receive mail.

### Android

1. Open the Gmail app.
2. Tap your profile picture, then **Add another account**, then **Other**.
3. Enter the full email address, then the mailbox password.
4. Choose **Personal (IMAP)** when Gmail asks for the account type. For POP3, choose **Personal (POP3)** instead and use port 995 below.
5. Incoming server: the mail hostname, port **993**, security **SSL/TLS**. Username is the full email address.
6. Outgoing server: the mail hostname, port **465**, security **SSL/TLS**. Turn sign-in on. Username is the full email address, and the password is the mailbox password.

### iOS

1. Open **Settings → Apps → Mail → Mail Accounts → Add Account**. On older iOS, open **Settings → Mail → Accounts → Add Account**.
2. Tap **Other**, then **Add Mail Account**.
3. Enter the name, the full email address, the mailbox password, and a description.
4. Tap **Next**, then choose **IMAP**. Choose **POP** only when you want POP3.
5. Incoming Mail Server: host is the mail hostname, user name is the full email address, password is the mailbox password.
6. Outgoing Mail Server: host is the mail hostname, user name is the full email address, password is the mailbox password.
7. Tap **Next**, then **Save**.
8. Open the new account, tap the account again, then **Advanced** on the incoming settings. Turn **Use SSL** on. Set the server port to **993** for IMAP, or **995** for POP3.
9. Go back, open **SMTP**, tap the primary server, turn **Use SSL** on, and set the server port to **465**. Turn authentication on.

## FAQ

### Why can't I send email?

Your internet provider blocks outgoing mail by default. Contact them and ask to allow sending, or send through an SMTP relay such as SendGrid or AWS SES. In the web console, open **Settings**, open **Outgoing relay**, turn it on, and save the relay host, username, and password. Use port 587 with STARTTLS, or port 465 with TLS.

### Why does the web interface show as unsecure?

The server uses a self-signed certificate by default. Buy a certificate from SSLs.com, Comodo, or another certificate provider. In the web console, open **Settings**, then **Certificate**, then **Upload certificate**. Upload the certificate file and the private key. Add the intermediate certificates when the provider sent them separately.

### I found a bug

Open a ticket in [GitHub Issues](https://github.com/tringuyen/email-server/issues).

## License

[MIT](LICENSE)

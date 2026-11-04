# Email Server

[![GitHub stars](https://img.shields.io/github/stars/tringuyen/email-server?style=social)](https://github.com/tringuyen/email-server/stargazers)

Open-source, self-hosted mail for one company and one domain. It receives mail, sends mail, and serves a web console and mailbox. SMTP, IMAP, and POP3 are built with Node.js only.

## Start from source

Node.js 20 or newer is required.

```bash
npm install
npm run build
npm start
```

Open the console at [http://127.0.0.1:3000](http://127.0.0.1:3000). The first visit creates the company and the administrator account. The company domain is entered on that page.

`npm start` runs the compiled program in `dist`. Run `npm run build` again after changing TypeScript.

Built-in defaults bind every interface and use the standard mail ports plus web port 3000. Those values stay fixed. An administrator sets the public name, the outgoing relay, and web security in Settings.

Messages are encrypted under `data`. Keep `data/storage-key` with that directory. Without that 32-byte file, mail that is already stored cannot be opened.

Ports 25, 143, 465, 587, 993, and 995 may require an administrator shell on Windows.

## Start with Docker

```bash
docker compose up --build
```

The mail store on the host is `./data`, mounted at `/opt/email-server/data` in the container. The console is at [http://127.0.0.1:3000](http://127.0.0.1:3000).

## License

[MIT](LICENSE)

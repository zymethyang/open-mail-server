FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/email-server

COPY package.json package-lock.json tsconfig.json tsconfig.web.json ./
COPY src ./src

RUN npm ci \
  && npx tsc \
  && npx tsc -p tsconfig.web.json \
  && npm prune --omit=dev \
  && mkdir -p /opt/email-server/data \
  && chown -R node:node /opt/email-server /opt/email-server/data

VOLUME ["/opt/email-server/data"]

EXPOSE 25 443 465 587 143 993 110 995

USER node

CMD ["node", "dist/application.js"]

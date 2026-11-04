FROM node:22-bookworm-slim

WORKDIR /opt/email-server

COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

RUN npm ci \
  && npx tsc \
  && npm prune --omit=dev \
  && mkdir -p /opt/email-server/data \
  && chown -R node:node /opt/email-server /opt/email-server/data

VOLUME ["/opt/email-server/data"]

EXPOSE 25 465 587 143 993 110 995 3000

USER node

CMD ["node", "dist/application.js"]

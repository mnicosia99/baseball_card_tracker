FROM node:24-alpine AS frontend-build

WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:24-alpine AS app

ENV NODE_ENV=production \
    PORT=3000 \
    CARDSIGHT_CARDS_FILE=/data/cards.json

WORKDIR /app
COPY --chown=node:node server/ ./server/
COPY --from=frontend-build --chown=node:node /workspace/frontend/dist/topps-card-gallery/ ./frontend/dist/topps-card-gallery/

USER node
EXPOSE 3000
CMD ["node", "server/index.mjs"]
# Aries: one container serves the API, the agent engine and the web app.
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npx vite build

FROM node:22-slim
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server ./
COPY --from=web /app/web/dist /app/web/dist
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/index.ts"]

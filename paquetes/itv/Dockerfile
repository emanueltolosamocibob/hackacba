FROM node:22-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
COPY paquetes ./paquetes
RUN npm ci --omit=dev && npx playwright install --with-deps chromium
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "paquetes/itv/src/server.mjs"]

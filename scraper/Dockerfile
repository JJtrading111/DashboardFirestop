FROM node:24-bookworm-slim
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
WORKDIR /app/scraper
COPY scraper/package.json scraper/package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY scraper ./
COPY public/bouwberichten-filters.mjs /app/public/bouwberichten-filters.mjs
CMD ["node", "worker.mjs"]

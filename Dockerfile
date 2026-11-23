FROM node:24-bookworm-slim
ENV NODE_ENV=production
ENV DATA_DIR=/data
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
EXPOSE 3000
CMD ["node", "server.mjs"]

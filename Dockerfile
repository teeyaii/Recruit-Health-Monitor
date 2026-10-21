FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node server ./server
COPY --chown=node:node dashboard ./dashboard
ENV NODE_ENV=production PORT=8080 COOKIE_SECURE=1
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]

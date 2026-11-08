# One image for both local-parity roles (C109): `api` runs the Express server, `worker` runs the SQS poller with the
# same Lambda handlers. Not used for hosting - Express deploys to Vercel and the workers to Lambda as zips.
FROM node:22.14.0-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
USER node
ENV NODE_ENV=production API_PORT=4000
EXPOSE 4000
CMD ["npx", "tsx", "src/interfaces/http/server.ts"]

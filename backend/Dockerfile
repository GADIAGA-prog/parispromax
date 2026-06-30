# Portable container image for the ParisPromax backend.
# Works on Railway, Fly.io, a VPS, or any container host.
#
#   docker build -t parispromax-backend ./backend
#   docker run -p 4000:4000 --env-file ./backend/.env parispromax-backend
#
# Requires a PostgreSQL DATABASE_URL at runtime (see .env.example).

FROM node:20-slim

# OpenSSL is needed by Prisma's query engine.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching).
COPY package*.json ./
RUN npm install --omit=dev

# Copy source.
COPY . .

# Generate the Postgres Prisma client at build time.
RUN npm run gen:prod-schema && npx prisma generate --schema=prisma/schema.production.prisma

ENV NODE_ENV=production
EXPOSE 4000

# On boot: sync the schema to the DB, then start the server.
CMD ["sh", "-c", "npx prisma db push --schema=prisma/schema.production.prisma --skip-generate && node src/server.js"]

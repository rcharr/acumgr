FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY server/package.json ./
RUN npm install --omit=dev

# Copy app files
COPY server/server.js ./
COPY server/setup.js ./
COPY server/config.example.json ./
COPY public/ ./public/

# Config is mounted at runtime — not baked into the image
# so you can update config.json without rebuilding

EXPOSE 9001

CMD ["node", "server.js"]

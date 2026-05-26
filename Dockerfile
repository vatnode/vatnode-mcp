# Dockerfile for Glama (https://glama.ai) introspection.
# Glama starts this container and performs an MCP introspection (tools/list)
# over stdio to read tool definitions and compute quality scores. The server
# itself is a stdio MCP server — it needs no ports, no network for startup
# (only validate_vat_number reaches the API at call time, not at boot).
FROM node:24-alpine

WORKDIR /app

# Install deps (build needs devDependencies: tsup, typescript)
COPY package.json ./
RUN npm install

# Build dist/index.js
COPY . .
RUN npm run build

# Start the stdio MCP server; Glama speaks MCP over stdin/stdout.
ENTRYPOINT ["node", "dist/index.js"]

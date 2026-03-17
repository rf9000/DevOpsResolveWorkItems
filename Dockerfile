FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

ENV STATE_DIR=/app/.state

CMD ["bun", "run", "start"]

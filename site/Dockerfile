FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app
ENV PORT=3399
COPY --from=build /app/dist ./dist
COPY --from=build /app/serve.ts ./serve.ts
EXPOSE 3399
CMD ["bun", "run", "serve.ts"]

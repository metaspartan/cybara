FROM oven/bun:1.3 AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY ui/package.json ui/bun.lock ./ui/

RUN bun install --frozen-lockfile
RUN cd ui && bun install --frozen-lockfile

COPY . .

RUN bun run build:all

FROM oven/bun:1.3 AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4269
ENV CYBARA_HOST=0.0.0.0

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/ui/dist ./ui/dist

EXPOSE 4269

CMD ["bun", "run", "dist/index.js"]

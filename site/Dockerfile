FROM oven/bun:1.3.14 AS build
WORKDIR /repo
COPY site/package.json site/bun.lock ./site/
RUN cd site && bun install --frozen-lockfile
COPY shared ./shared
COPY site ./site
RUN cd site && bun run build

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app
ENV PORT=3399
COPY --from=build /repo/site/dist ./dist
COPY --from=build /repo/site/serve.ts ./serve.ts
COPY --from=build /repo/site/downloadStats.ts ./downloadStats.ts
EXPOSE 3399
CMD ["bun", "run", "serve.ts"]

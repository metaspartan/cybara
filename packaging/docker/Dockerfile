FROM debian:bookworm-slim

ARG VERSION
ARG REPO=metaspartan/cybara
ARG TARGETARCH

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) ARCH=x64 ;; \
      arm64) ARCH=arm64 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    base="https://github.com/${REPO}/releases/download/v${VERSION}"; \
    curl -fL "${base}/cybara-v${VERSION}-linux-${ARCH}-cli" -o /usr/local/bin/cybara; \
    curl -fL "${base}/cybara-v${VERSION}-linux-${ARCH}-cli.sha256" -o /tmp/cybara.sha256; \
    echo "$(awk '{print $1}' /tmp/cybara.sha256)  /usr/local/bin/cybara" | sha256sum -c -; \
    chmod +x /usr/local/bin/cybara; \
    rm -f /tmp/cybara.sha256

ENV CYBARA_HOME=/data \
    CYBARA_HOST=0.0.0.0 \
    PORT=4269

VOLUME ["/data"]
EXPOSE 4269

ENTRYPOINT ["cybara"]
CMD ["start"]

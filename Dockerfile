# Build the Go binary and embed the static Korean web interface.
FROM golang:1.23-bookworm AS build
WORKDIR /build
COPY go.mod ./
COPY *.go ./
COPY index.html ./
COPY src ./src
RUN gofmt -w *.go && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/pconn .

# This container holds the entire panel plus ALL managed Java servers.
# It is not equivalent to per-server Docker isolation in Pterodactyl Wings.
FROM eclipse-temurin:21-jre-jammy
RUN groupadd --gid 10001 pconn && \
    useradd --uid 10001 --gid 10001 --home-dir /var/lib/pconn --shell /usr/sbin/nologin pconn && \
    mkdir -p /var/lib/pconn && chown -R 10001:10001 /var/lib/pconn
WORKDIR /opt/pconn
COPY --from=build /out/pconn /opt/pconn/pconn
ENV PANEL_BIND_HOST=0.0.0.0 \
    PANEL_PORT=4173 \
    PANEL_DATA_DIR=/var/lib/pconn \
    PANEL_JAVA_BIN=java
USER 10001:10001
EXPOSE 4173/tcp 25565/tcp
VOLUME ["/var/lib/pconn"]
ENTRYPOINT ["/opt/pconn/pconn"]

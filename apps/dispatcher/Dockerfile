# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS build
WORKDIR /src

# Cache dependencies.
COPY apps/dispatcher/go.mod apps/dispatcher/go.sum ./apps/dispatcher/
WORKDIR /src/apps/dispatcher
RUN go mod download

COPY apps/dispatcher ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/dispatcher ./cmd/dispatcher

# Alpine rather than distroless: the compose healthcheck needs wget, and a
# shell in the container is worth the extra few MB for debugging.
FROM alpine:3.20
RUN adduser -D -u 10001 dispatcher
COPY --from=build /out/dispatcher /dispatcher
USER dispatcher
EXPOSE 8090
ENTRYPOINT ["/dispatcher"]
# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS builder
WORKDIR /src
COPY apps/mailcore/go.mod apps/mailcore/go.sum ./
RUN go mod download
COPY apps/mailcore/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/mailcore ./cmd/mailcore

FROM alpine:3.21
RUN apk add --no-cache ca-certificates wget
COPY --from=builder /out/mailcore /mailcore
ENTRYPOINT ["/mailcore"]

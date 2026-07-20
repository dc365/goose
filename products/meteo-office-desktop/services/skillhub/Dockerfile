FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/meteomate-skillhub ./cmd/skillhub

FROM alpine:3.21
RUN addgroup -S skillhub && adduser -S -G skillhub skillhub
COPY --from=build /out/meteomate-skillhub /usr/local/bin/meteomate-skillhub
USER skillhub
WORKDIR /var/lib/meteomate-skillhub
EXPOSE 8088
ENTRYPOINT ["meteomate-skillhub"]
CMD ["-addr", "0.0.0.0:8088", "-data", "/var/lib/meteomate-skillhub/data"]

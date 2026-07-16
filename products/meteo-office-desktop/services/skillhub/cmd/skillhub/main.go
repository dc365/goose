package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/api"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/trust"
)

func main() {
	var (
		addr    = flag.String("addr", envOr("METEOMATE_SKILLHUB_ADDR", "127.0.0.1:8088"), "HTTP listen address")
		dataDir = flag.String("data", envOr("METEOMATE_SKILLHUB_DATA", "./data"), "data directory")
		seedDir = flag.String("seed-dir", os.Getenv("METEOMATE_SKILLHUB_SEED_DIR"), "optional bundled Skill directory")
	)
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	tokens, err := auth.ParseTokensJSON(os.Getenv("METEOMATE_SKILLHUB_TOKENS"))
	fatalIf(err, "parse METEOMATE_SKILLHUB_TOKENS")
	if len(tokens) == 0 {
		logger.Warn("no write tokens configured; public read APIs remain available", "env", "METEOMATE_SKILLHUB_TOKENS")
	}

	root, err := filepath.Abs(*dataDir)
	fatalIf(err, "resolve data directory")
	dataStore, err := store.Open(root)
	fatalIf(err, "open store")
	signer, err := trust.OpenOrCreate(filepath.Join(root, "trust"))
	fatalIf(err, "open signing key")
	server, err := api.New(api.Config{
		Store: dataStore, Signer: signer, Authenticator: auth.New(tokens), Logger: logger,
	})
	fatalIf(err, "create API server")
	if *seedDir != "" {
		if err := server.SeedDirectory(*seedDir); err != nil {
			fatalIf(err, "seed bundled skills")
		}
		logger.Info("bundled Skills seeded", "directory", *seedDir)
	}

	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       70 * time.Second,
		WriteTimeout:      70 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		logger.Info("MeteoMate SkillHub listening", "addr", *addr, "data", root, "keyId", signer.KeyID())
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fatalIf(err, "serve HTTP")
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func fatalIf(err error, operation string) {
	if err == nil {
		return
	}
	_, _ = fmt.Fprintf(os.Stderr, "%s: %v\n", operation, err)
	os.Exit(1)
}

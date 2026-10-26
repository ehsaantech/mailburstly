package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all dispatcher configuration, loaded from environment variables.
type Config struct {
	DatabaseURL          string
	EmailEngineURL       string
	EmailEngineSecret    string
	Port                 int
	PollInterval         time.Duration
	BatchSize            int
	MaxConcurrency       int
	MinGapSeconds        int
	RandomJitterSeconds  int
	DefaultMailboxCap    int
	HardMailboxCap       int
}

// Load reads configuration from environment variables with sensible defaults.
func Load() (Config, error) {
	cfg := Config{
		DatabaseURL:         getenv("DATABASE_URL", "postgres://mailrung:change-me-postgres@localhost:5433/mailrung"),
		EmailEngineURL:      getenv("EMAILENGINE_API_URL", "http://localhost:3003"),
		EmailEngineSecret:   getenv("EMAILENGINE_API_TOKEN", getenv("EMAILENGINE_SECRET", "")),
		Port:                getenvInt("DISPATCHER_PORT", 8090),
		PollInterval:        time.Duration(getenvInt("DISPATCHER_POLL_INTERVAL_MS", 2000)) * time.Millisecond,
		BatchSize:           getenvInt("DISPATCHER_BATCH_SIZE", 500),
		MaxConcurrency:      getenvInt("DISPATCHER_MAX_CONCURRENCY", 25),
		// Both are floors, not defaults: the campaign's own email_gap_minutes
		// and random_wait_max decide the pacing, and these can only make it
		// stricter. Zero means "no global floor".
		MinGapSeconds:       getenvInt("DEFAULT_MIN_GAP_SECONDS", 0),
		RandomJitterSeconds: getenvInt("DEFAULT_RANDOM_JITTER_SECONDS", 0),
		DefaultMailboxCap:   getenvInt("DEFAULT_MAILBOX_DAILY_CAP", 30),
		HardMailboxCap:      getenvInt("HARD_MAILBOX_DAILY_CAP", 50),
	}

	if cfg.DatabaseURL == "" {
		return cfg, fmt.Errorf("DATABASE_URL is required")
	}

	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all dispatcher configuration, loaded from environment variables.
type Config struct {
	DatabaseURL         string
	MailcoreURL      string
	MailcoreSecret   string
	Port                int
	PollInterval        time.Duration
	BatchSize           int
	MaxConcurrency      int
	MinGapSeconds       int
	RandomJitterSeconds int
	DefaultMailboxCap   int
	HardMailboxCap      int

	// Alerting. The recipients live in the database; this only decides
	// whether an alert can be sent, and from where.
	ResendAPIKey    string
	AlertFrom       string
	AlertEnabled    bool
	AlertCooldown   time.Duration
	AlertMaxPerHour int
}

// Load reads configuration from environment variables with sensible defaults.
func Load() (Config, error) {
	cfg := Config{
		DatabaseURL:       getenv("DATABASE_URL", "postgres://mailrung:change-me-postgres@localhost:5433/mailrung"),
		MailcoreURL:    getenv("MAILCORE_API_URL", "http://localhost:3003"),
		MailcoreSecret: getenv("MAILCORE_API_TOKEN", ""),
		Port:              getenvInt("DISPATCHER_PORT", 8090),
		PollInterval:      time.Duration(getenvInt("DISPATCHER_POLL_INTERVAL_MS", 2000)) * time.Millisecond,
		BatchSize:         getenvInt("DISPATCHER_BATCH_SIZE", 500),
		MaxConcurrency:    getenvInt("DISPATCHER_MAX_CONCURRENCY", 25),
		// Both are floors, not defaults: the campaign's own email_gap_minutes
		// and random_wait_max decide the pacing, and these can only make it
		// stricter. Zero means "no global floor".
		MinGapSeconds:       getenvInt("DEFAULT_MIN_GAP_SECONDS", 0),
		RandomJitterSeconds: getenvInt("DEFAULT_RANDOM_JITTER_SECONDS", 0),
		DefaultMailboxCap:   getenvInt("DEFAULT_MAILBOX_DAILY_CAP", 30),
		HardMailboxCap:      getenvInt("HARD_MAILBOX_DAILY_CAP", 50),

		ResendAPIKey:    getenv("RESEND_API_KEY", ""),
		AlertFrom:       getenv("ALERT_FROM_EMAIL", "alerts@mail.ehsaanlabs.com"),
		AlertEnabled:    getenvBool("ALERT_ENABLED", true),
		AlertCooldown:   time.Duration(getenvInt("ALERT_COOLDOWN_MS", 300000)) * time.Millisecond,
		AlertMaxPerHour: getenvInt("ALERT_MAX_PER_HOUR", 20),
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

// getenvBool reads a boolean the way an operator writes it. Anything that is
// not recognisably false is true, so a typo does not silently mute alerting.
func getenvBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "0", "false", "no", "off":
		return false
	default:
		return true
	}
}

// Package config holds all env-driven configuration.
package config

import (
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port                  int
	PublicURL             string
	DatabaseURL           string
	APIToken              string
	WebhookURL            string
	WebhookSecret         string
	EncryptionKey         []byte
	GoogleClientID        string
	GoogleClientSecret    string
	MicrosoftClientID     string
	MicrosoftClientSecret string
	MicrosoftTenant       string
	SyncIntervalSeconds   int
	InitialSyncDays       int
}

func Load() (Config, error) {
	c := Config{
		Port:                  envInt("MAILCORE_PORT", 3004),
		PublicURL:             envStr("MAILCORE_PUBLIC_URL", "http://localhost:3004"),
		DatabaseURL:           envStr("DATABASE_URL", "postgres://mailrung:change-me-postgres@localhost:5433/mailrung"),
		APIToken:              envStr("MAILCORE_API_TOKEN", envStr("EMAILENGINE_API_TOKEN", "")),
		WebhookURL:            envStr("MAILCORE_WEBHOOK_URL", envStr("WORKER_WEBHOOK_URL", "http://worker:3002/webhooks/emailengine")),
		WebhookSecret:         envStr("MAILCORE_WEBHOOK_SECRET", envStr("EMAILENGINE_SERVICE_SECRET", "")),
		GoogleClientID:        envStr("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:    envStr("GOOGLE_CLIENT_SECRET", ""),
		MicrosoftClientID:     envStr("MICROSOFT_CLIENT_ID", ""),
		MicrosoftClientSecret: envStr("MICROSOFT_CLIENT_SECRET", ""),
		MicrosoftTenant:       envStr("MICROSOFT_TENANT", envStr("MICROSOFT_AUTHORITY", "common")),
		SyncIntervalSeconds:   envInt("MAILCORE_SYNC_INTERVAL", 30),
		InitialSyncDays:       envInt("MAILCORE_INITIAL_SYNC_DAYS", 14),
	}
	key, err := decodeKey(envStr("MAILCORE_ENCRYPTION_KEY", ""))
	if err != nil {
		return c, fmt.Errorf("MAILCORE_ENCRYPTION_KEY: %w", err)
	}
	if len(key) != 0 && len(key) != 32 {
		return c, fmt.Errorf("MAILCORE_ENCRYPTION_KEY must be 16/32 bytes, got %d", len(key))
	}
	c.EncryptionKey = key
	if c.WebhookSecret == "" {
		return c, fmt.Errorf("MAILCORE_WEBHOOK_SECRET is required (refusing to deliver or accept unsigned events)")
	}
	return c, nil
}

func envStr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func envInt(k string, d int) int {
	if v := os.Getenv(k); v != "" {
		n, err := strconv.Atoi(v)
		if err == nil {
			return n
		}
	}
	return d
}
func decodeKey(s string) ([]byte, error) {
	if s == "" {
		// allow start-up in dev with an ephemeral key, clearly logged
		return make([]byte, 32), nil
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err == nil {
		return b, nil
	}
	return []byte(s), nil
}

package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mailrung/mailcore/internal/config"
	"github.com/mailrung/mailcore/internal/crypto"
	"github.com/mailrung/mailcore/internal/httpapi"
	"github.com/mailrung/mailcore/internal/store"
	"github.com/mailrung/mailcore/internal/webhook"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Println("config error:", err)
		os.Exit(1)
	}
	if len(cfg.EncryptionKey) == 0 || allZero(cfg.EncryptionKey) {
		// dev fallback: persist an ephemeral key so tokens survive restarts
		path := "/tmp/mailcore.key"
		if b, err := os.ReadFile(path); err == nil && len(b) == 32 {
			cfg.EncryptionKey = b
		} else {
			b := make([]byte, 32)
			for i := range b {
				b[i] = byte(i*7 + 13)
			}
			os.WriteFile(path, b, 0600)
			cfg.EncryptionKey = b
			fmt.Println("WARNING: MAILCORE_ENCRYPTION_KEY not set; using dev key (not for prod)")
		}
	}
	keyB64 := base64.StdEncoding.EncodeToString(cfg.EncryptionKey)
	_ = keyB64
	_ = crypto.Seal

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Println("db error:", err)
		os.Exit(1)
	}
	defer st.Close()

	srv := &httpapi.Server{Cfg: cfg, Store: st}

	// background webhook delivery loop
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
				deliverWebhooks(ctx, st, cfg)
			}
		}
	}()

	// background sync loop
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Duration(cfg.SyncIntervalSeconds) * time.Second):
				runSync(ctx, st, cfg)
			}
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	go func() { <-sig; cancel() }()

	if err := srv.Listen(); err != nil {
		fmt.Println("listen:", err)
	}
}

func allZero(b []byte) bool {
	for _, x := range b {
		if x != 0 {
			return false
		}
	}
	return true
}

func deliverWebhooks(ctx context.Context, st *store.Store, cfg config.Config) {
	evs, err := st.FetchDueEvents(ctx, 50)
	if err != nil {
		return
	}
	for _, e := range evs {
		err := webhook.Deliver(ctx, cfg.WebhookURL, cfg.WebhookSecret, e.ID, e.Event, []byte(e.Payload))
		if err == nil {
			st.MarkEventDelivered(ctx, e.ID)
		} else {
			n := e.Attempts + 1
			next := webhook.Backoff(n)
			st.MarkEventFailed(ctx, e.ID, err.Error(), next)
		}
	}
}

func runSync(ctx context.Context, st *store.Store, cfg config.Config) {
	accs, err := st.ListAccounts(ctx)
	if err != nil {
		return
	}
	for _, a := range accs {
		// sync is a no-op unless access token decrypts; placeholder for v1 M2
		_ = a
	}
}

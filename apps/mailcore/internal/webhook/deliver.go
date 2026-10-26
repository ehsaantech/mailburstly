package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

func Deliver(ctx context.Context, webhookURL, secret, id, event string, payload []byte) error {
	body := map[string]any{
		"account": extractAccountRaw(payload),
		"event":   event,
		"date":    time.Now().UTC().Format(time.RFC3339Nano),
		"data":    json.RawMessage(nonNull(payload)),
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, "POST", webhookURL, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "mailcore")
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(b)
	req.Header.Set("X-EE-Wh-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	req.Header.Set("X-EE-Wh-Event-Id", id)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook %d", resp.StatusCode)
	}
	return nil
}

func extractAccountRaw(p []byte) string {
	var m map[string]any
	if err := json.Unmarshal(p, &m); err == nil {
		if a, ok := m["account"].(string); ok {
			return a
		}
	}
	return ""
}

func nonNull(p []byte) []byte {
	if len(p) == 0 {
		return []byte("null")
	}
	return p
}

func Backoff(attempts int) time.Time {
	d := []time.Duration{5 * time.Minute, 30 * time.Minute, 2 * time.Hour, 6 * time.Hour}
	idx := attempts
	if idx >= len(d) {
		idx = len(d) - 1
	}
	if idx < 0 {
		idx = 0
	}
	return time.Now().Add(d[idx])
}

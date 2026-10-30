// Package alerts raises an email when something breaks.
//
// The dispatcher is the send hot path: a campaign email that never leaves
// is a silent failure, and logs nobody reads are not a safety net. Resend
// is the transport because it is a completely separate provider from the
// mail gateway we send through — an alert still goes out when the gateway
// is the thing that broke.
//
// The rules match the TypeScript alerter in @mailrung/shared: one email
// per failure kind per cooldown window, a repeat count on the next email,
// and a hard cap per hour.
//
// The Resend client is written by hand rather than taken from the Go SDK:
// the only one that exists was last published in July 2023, and this
// binary should not depend on an unmaintained module to tell the operator
// that the mail gateway is down.
package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Severity is how loud an alert is.
type Severity string

const (
	// SeverityError means something is broken.
	SeverityError Severity = "error"
	// SeverityWarning means something is degraded but still working.
	SeverityWarning Severity = "warning"
)

// Config is the alerting configuration, read from the environment.
type Config struct {
	// APIKey is the Resend api key. Empty disables alerting.
	APIKey string
	// From is the verified sender, e.g. "alerts@mail.ehsaanlabs.com".
	From string
	// Enabled is the kill switch.
	Enabled bool
	// Cooldown is how long one failure kind stays quiet.
	Cooldown time.Duration
	// MaxPerHour caps how many alert emails go out in an hour.
	MaxPerHour int
	// Timeout is how long a single delivery may take.
	Timeout time.Duration
}

// Recipient is one address that should hear about alerts.
type Recipient struct {
	Email string
	Name  string
	// Severity is the lowest severity this address wants: "warning" means
	// "tell me everything", "error" means "only when it is broken".
	Severity Severity
}

// Alerter raises alerts.
type Alerter struct {
	cfg    Config
	pool   *pgxpool.Pool
	client *http.Client

	mu sync.Mutex
	// lastSent is when a key last had an email sent for it.
	lastSent map[string]time.Time
	// repeats counts how many times a key was suppressed since the last
	// email, so the next one can say "this happened N more times".
	repeats map[string]int
	// sentAt is the delivery timestamps of the last hour.
	sentAt []time.Time
}

// New creates an alerter.
func New(cfg Config, pool *pgxpool.Pool) *Alerter {
	if cfg.Cooldown <= 0 {
		cfg.Cooldown = 5 * time.Minute
	}
	if cfg.MaxPerHour <= 0 {
		cfg.MaxPerHour = 20
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 10 * time.Second
	}
	return &Alerter{
		cfg:      cfg,
		pool:     pool,
		client:   &http.Client{Timeout: cfg.Timeout},
		lastSent: make(map[string]time.Time),
		repeats:  make(map[string]int),
	}
}

// Enabled reports whether alerts can be sent at all.
func (a *Alerter) Enabled() bool {
	return a != nil && a.cfg.Enabled && a.cfg.APIKey != ""
}

// Alert raises an alert.
//
// It never blocks the caller and never returns an error: a failure to
// notify is a log line, not a second failure on top of the first.
//
// workspaceID may be empty, in which case the primary workspace is used.
func (a *Alerter) Alert(
	ctx context.Context,
	workspaceID string,
	key string,
	title string,
	message string,
	severity Severity,
	fields map[string]string,
) {
	if !a.Enabled() {
		return
	}

	now := time.Now()

	allowed, repeats := a.allow(key, now)
	if !allowed {
		return
	}

	// The send hot path must not wait for a network round trip.
	go func() {
		// The caller's context may be cancelled the moment it returns, and
		// the alert still has to go out.
		sendCtx, cancel := context.WithTimeout(context.Background(), a.cfg.Timeout)
		defer cancel()
		a.deliver(sendCtx, workspaceID, key, title, message, severity, fields, repeats)
	}()
}

// allow decides whether an alert may be sent now, and how many repeats have
// been collapsed into it.
//
// The second return value is the number of occurrences that were suppressed
// since the last email for this key, so the next email can say "this
// happened N more times".
//
// The attempt is recorded here, before the delivery: sending takes a moment,
// and three failures inside that window must still be one email.
func (a *Alerter) allow(key string, now time.Time) (bool, int) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if last, ok := a.lastSent[key]; ok && now.Sub(last) < a.cfg.Cooldown {
		a.repeats[key]++
		return false, 0
	}

	repeats := a.repeats[key]
	a.lastSent[key] = now
	return true, repeats
}

// record resets the repeat counter after a delivery.
func (a *Alerter) record(key string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.repeats[key] = 0
}

// release gives a reservation back.
//
// Used when the alert turned out not to be sendable after all — nobody
// wants this severity, say. The next occurrence must be free to alert again
// rather than wait out a cooldown it never used.
func (a *Alerter) release(key string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.lastSent, key)
}

// deliver sends one alert.
func (a *Alerter) deliver(
	ctx context.Context,
	workspaceID string,
	key string,
	title string,
	message string,
	severity Severity,
	fields map[string]string,
	repeats int,
) {
	if a.overCap(time.Now()) {
		log.Printf("alert %s suppressed: hourly cap of %d reached", key, a.cfg.MaxPerHour)
		a.release(key)
		return
	}

	if workspaceID == "" {
		if a.pool == nil {
			log.Printf("alert %s: no database to read the recipients from", key)
			a.release(key)
			return
		}
		resolved, err := a.primaryWorkspace(ctx)
		if err != nil {
			log.Printf("alert %s: cannot resolve the workspace: %v", key, err)
			a.release(key)
			return
		}
		workspaceID = resolved
	}

	if a.pool == nil {
		log.Printf("alert %s: no database to read the recipients from", key)
		a.release(key)
		return
	}

	recipients, err := a.recipients(ctx, workspaceID)
	if err != nil {
		log.Printf("alert %s: cannot read the recipients: %v", key, err)
		a.release(key)
		return
	}

	to := filterRecipients(recipients, severity)
	if len(to) == 0 {
		log.Printf("alert %s: no enabled recipient wants severity %s", key, severity)
		a.release(key)
		return
	}

	subject, htmlBody, textBody := render(title, message, key, severity, fields, repeats)

	if err := a.send(ctx, to, subject, htmlBody, textBody); err != nil {
		log.Printf("alert %s could not be sent: %v", key, err)
		// The repeats are kept, so the next alert can still say how many
		// there were.
	} else {
		a.mu.Lock()
		a.sentAt = append(a.sentAt, time.Now())
		a.mu.Unlock()
		log.Printf("alert %s sent to %v", key, to)
		a.record(key)
	}
}

// overCap reports whether the hourly cap has been reached.
func (a *Alerter) overCap(now time.Time) bool {
	a.mu.Lock()
	defer a.mu.Unlock()

	cutoff := now.Add(-time.Hour)
	kept := a.sentAt[:0]
	for _, at := range a.sentAt {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	a.sentAt = kept

	return len(a.sentAt) >= a.cfg.MaxPerHour
}

// primaryWorkspace returns the one workspace's id.
func (a *Alerter) primaryWorkspace(ctx context.Context) (string, error) {
	var id string
	err := a.pool.QueryRow(ctx, `SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1`).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, nil
}

// recipients reads the enabled alert recipients of a workspace.
func (a *Alerter) recipients(ctx context.Context, workspaceID string) ([]Recipient, error) {
	rows, err := a.pool.Query(ctx, `
		SELECT email, COALESCE(name, ''), severity
		FROM alert_recipients
		WHERE workspace_id = $1 AND enabled = true
		ORDER BY created_at ASC
	`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Recipient
	for rows.Next() {
		var r Recipient
		var severity string
		if err := rows.Scan(&r.Email, &r.Name, &severity); err != nil {
			return nil, err
		}
		r.Severity = Severity(severity)
		out = append(out, r)
	}
	return out, rows.Err()
}

// filterRecipients keeps the addresses that want this severity.
func filterRecipients(recipients []Recipient, severity Severity) []string {
	var to []string
	for _, r := range recipients {
		if severity == SeverityError || r.Severity == SeverityWarning {
			to = append(to, r.Email)
		}
	}
	return to
}

// resendRequest is the body of a Resend send.
type resendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    string   `json:"text"`
}

// send delivers one message through Resend.
func (a *Alerter) send(ctx context.Context, to []string, subject, htmlBody, textBody string) error {
	payload, err := json.Marshal(resendRequest{
		From:    a.cfg.From,
		To:      to,
		Subject: subject,
		HTML:    htmlBody,
		Text:    textBody,
	})
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.cfg.APIKey)

	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		buf := make([]byte, 1024)
		n, _ := resp.Body.Read(buf)
		return fmt.Errorf("resend returned %d: %s", resp.StatusCode, strings.TrimSpace(string(buf[:n])))
	}
	return nil
}

// render builds the subject, the html body and the plain text body.
func render(title, message, key string, severity Severity, fields map[string]string, repeats int) (string, string, string) {
	label := "ERROR"
	if severity == SeverityWarning {
		label = "WARNING"
	}

	subject := fmt.Sprintf("[dispatcher] %s — %s", label, title)

	repeatNote := ""
	if repeats > 0 {
		repeatNote = fmt.Sprintf(
			`<p style="margin:0 0 12px;color:#b45309;font-size:13px;">This happened <strong>%d</strong> more time%s since the last alert. The repeats were collapsed into this one email.</p>`,
			repeats,
			plural(repeats),
		)
	}

	var rows strings.Builder
	keys := make([]string, 0, len(fields))
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		rows.WriteString(fmt.Sprintf(
			`<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:12px;white-space:nowrap;vertical-align:top;">%s</td>`+
				`<td style="padding:4px 0;color:#111827;font-size:13px;word-break:break-word;">%s</td></tr>`,
			html.EscapeString(k),
			html.EscapeString(fields[k]),
		))
	}

	table := ""
	if len(keys) > 0 {
		table = `<table style="border-collapse:collapse;margin:0 0 14px;">` + rows.String() + `</table>`
	}

	background, foreground := "#fee2e2", "#991b1b"
	if severity == SeverityWarning {
		background, foreground = "#fef3c7", "#92400e"
	}

	htmlBody := fmt.Sprintf(`<div style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.5;color:#111827;max-width:640px;">
  <div style="display:inline-block;padding:2px 8px;border-radius:4px;background:%s;color:%s;font-size:11px;font-weight:600;letter-spacing:0.04em;">%s</div>
  <h1 style="margin:10px 0 6px;font-size:18px;font-weight:600;">%s</h1>
  <p style="margin:0 0 12px;color:#374151;">%s</p>
  %s
  %s
  <p style="margin:0;color:#6b7280;font-size:12px;">Service: dispatcher · Key: %s · Time: %s</p>
</div>`,
		background, foreground, label,
		html.EscapeString(title),
		html.EscapeString(message),
		repeatNote,
		table,
		html.EscapeString(key),
		time.Now().UTC().Format(time.RFC3339),
	)

	var text strings.Builder
	fmt.Fprintf(&text, "%s: %s\n\n%s\n", label, title, message)
	if repeats > 0 {
		fmt.Fprintf(&text, "\nThis happened %d more time%s since the last alert.\n", repeats, plural(repeats))
	}
	if len(keys) > 0 {
		text.WriteString("\nDetails:\n")
		for _, k := range keys {
			fmt.Fprintf(&text, "  %s: %s\n", k, fields[k])
		}
	}
	fmt.Fprintf(&text, "\nService: dispatcher · Key: %s · Time: %s\n", key, time.Now().UTC().Format(time.RFC3339))

	return subject, htmlBody, text.String()
}

// plural returns the "s" for anything but one.
func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

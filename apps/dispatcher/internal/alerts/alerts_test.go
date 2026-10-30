package alerts

import (
	"strings"
	"testing"
	"time"
)

func TestFilterRecipients(t *testing.T) {
	recipients := []Recipient{
		{Email: "errors@example.com", Severity: SeverityError},
		{Email: "everything@example.com", Severity: SeverityWarning},
	}

	// An error is worth telling everybody about: a recipient on "error"
	// still wants errors, and one on "warning" wants everything.
	got := filterRecipients(recipients, SeverityError)
	if len(got) != 2 {
		t.Fatalf("error severity: got %v, want both recipients", got)
	}

	// A warning only reaches the addresses that asked for warnings.
	got = filterRecipients(recipients, SeverityWarning)
	if len(got) != 1 || got[0] != "everything@example.com" {
		t.Fatalf("warning severity: got %v, want [everything@example.com]", got)
	}
}

func TestAllowDeduplicatesInsideTheCooldown(t *testing.T) {
	a := New(Config{APIKey: "x", Cooldown: time.Minute, MaxPerHour: 20}, nil)

	now := time.Now()

	allowed, repeats := a.allow("dispatcher.submit_failed", now)
	if !allowed {
		t.Fatal("the first alert should be allowed")
	}
	if repeats != 0 {
		t.Fatalf("repeats: got %d, want 0", repeats)
	}
	a.record("dispatcher.submit_failed")

	allowed, _ = a.allow("dispatcher.submit_failed", now.Add(10*time.Second))
	if allowed {
		t.Fatal("the second alert inside the cooldown should be suppressed")
	}

	allowed, repeats = a.allow("dispatcher.submit_failed", now.Add(2*time.Minute))
	if !allowed {
		t.Fatal("the alert after the cooldown should be allowed")
	}
	if repeats != 1 {
		t.Fatalf("repeats: got %d, want 1", repeats)
	}
}

// A failure that arrives while the previous alert is still being delivered
// must be folded into it, not sent alongside it.
func TestAllowReservesBeforeTheDelivery(t *testing.T) {
	a := New(Config{APIKey: "x", Cooldown: time.Minute, MaxPerHour: 20}, nil)

	now := time.Now()

	allowed, _ := a.allow("dispatcher.submit_failed", now)
	if !allowed {
		t.Fatal("the first alert should be allowed")
	}

	// The delivery has not happened yet, but the key is already reserved.
	allowed, _ = a.allow("dispatcher.submit_failed", now)
	if allowed {
		t.Fatal("a failure during an in-flight delivery should be suppressed")
	}
}

func TestAllowTreatsDifferentKeysIndependently(t *testing.T) {
	a := New(Config{APIKey: "x", Cooldown: time.Minute, MaxPerHour: 20}, nil)

	now := time.Now()
	a.allow("dispatcher.submit_failed", now)
	a.record("dispatcher.submit_failed")

	allowed, _ := a.allow("dispatcher.claim_failed", now)
	if !allowed {
		t.Fatal("a different key should not be suppressed")
	}
}

func TestOverCap(t *testing.T) {
	a := New(Config{APIKey: "x", MaxPerHour: 2}, nil)

	now := time.Now()
	a.sentAt = []time.Time{now, now}

	if !a.overCap(now) {
		t.Fatal("the hourly cap should be reached")
	}

	a.sentAt = []time.Time{now.Add(-2 * time.Hour), now.Add(-2 * time.Hour)}
	if a.overCap(now) {
		t.Fatal("alerts older than an hour should not count towards the cap")
	}
}

func TestRender(t *testing.T) {
	subject, htmlBody, textBody := render(
		"A campaign email could not be sent",
		"The mail gateway refused the message.",
		"dispatcher.submit_failed",
		SeverityError,
		map[string]string{"job": "abc", "recipient": "lead@example.com"},
		3,
	)

	if !strings.Contains(subject, "ERROR") {
		t.Errorf("subject should carry the severity: %q", subject)
	}
	if !strings.Contains(subject, "A campaign email could not be sent") {
		t.Errorf("subject should carry the title: %q", subject)
	}
	if !strings.Contains(htmlBody, "more times") {
		t.Error("the html should say how many times it repeated")
	}
	if !strings.Contains(textBody, "3 more times") {
		t.Errorf("the text should say how many times it repeated: %q", textBody)
	}
	if !strings.Contains(htmlBody, "lead@example.com") {
		t.Error("the html should carry the details")
	}
	if !strings.Contains(textBody, "job: abc") {
		t.Errorf("the text should carry the details: %q", textBody)
	}
	if !strings.Contains(textBody, "Key: dispatcher.submit_failed") {
		t.Errorf("the text should carry the key: %q", textBody)
	}
}

func TestRenderEscapesHtml(t *testing.T) {
	_, htmlBody, textBody := render(
		"<script>alert(1)</script>",
		"a & b",
		"k",
		SeverityError,
		nil,
		0,
	)

	if strings.Contains(htmlBody, "<script>") {
		t.Error("the html must not contain raw markup from the title")
	}
	if !strings.Contains(htmlBody, "&lt;script&gt;") {
		t.Error("the html should contain the escaped title")
	}
	if !strings.Contains(textBody, "<script>alert(1)</script>") {
		t.Error("the plain text should contain the raw title")
	}
}

func TestDisabledWithoutAKey(t *testing.T) {
	a := New(Config{APIKey: "", Enabled: true}, nil)
	if a.Enabled() {
		t.Fatal("an alerter without a key must be disabled")
	}

	b := New(Config{APIKey: "x", Enabled: false}, nil)
	if b.Enabled() {
		t.Fatal("an alerter that is switched off must be disabled")
	}
}

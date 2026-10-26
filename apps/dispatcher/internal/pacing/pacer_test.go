package pacing

import (
	"testing"
	"time"

	"github.com/mailrung/dispatcher/internal/types"
)

/** The dispatcher's defaults: no global floor, so the campaign decides. */
func testPacer() *Pacer {
	return &Pacer{
		MinGapSeconds:       0,
		RandomJitterSeconds: 0,
		DefaultMailboxCap:   30,
		HardMailboxCap:      50,
	}
}

func TestPacerUsesTheCampaignGap(t *testing.T) {
	// The campaign asks for one minute between sends. That is what happens.
	lastSend := time.Now().Add(-30 * time.Second)
	now := time.Now()

	jobs := []types.SendJob{{
		MailboxID:         "mb-1",
		EmailGapMinutes:   1,
		LastMailboxSendAt: &lastSend,
	}}

	slots := testPacer().ComputeSlots(jobs, nil, map[string]int{}, now)
	if len(slots) != 1 {
		t.Fatalf("expected one slot, got %d", len(slots))
	}
	if !slots[0].Allowed {
		t.Fatalf("slot should be allowed: %s", slots[0].Reason)
	}

	gap := slots[0].SendAt.Sub(lastSend)
	if gap > 2*time.Minute {
		t.Fatalf("gap = %s, want about 1m", gap)
	}
}

func TestPacerGlobalFloorMakesSendingStricter(t *testing.T) {
	// A global floor of nine minutes overrides a campaign that asked for
	// one. The floor can only make sending slower, never faster.
	lastSend := time.Now().Add(-30 * time.Second)
	now := time.Now()

	pacer := testPacer()
	pacer.MinGapSeconds = 540

	jobs := []types.SendJob{{
		MailboxID:         "mb-1",
		EmailGapMinutes:   1,
		LastMailboxSendAt: &lastSend,
	}}

	slots := pacer.ComputeSlots(jobs, nil, map[string]int{}, now)
	gap := slots[0].SendAt.Sub(lastSend)
	if gap < 8*time.Minute {
		t.Fatalf("gap = %s, want about 9m", gap)
	}
}

func TestPacerWithoutACampaignGapUsesTheFloor(t *testing.T) {
	lastSend := time.Now().Add(-30 * time.Second)
	now := time.Now()

	pacer := testPacer()
	pacer.MinGapSeconds = 540

	jobs := []types.SendJob{{
		MailboxID:         "mb-1",
		LastMailboxSendAt: &lastSend,
	}}

	slots := pacer.ComputeSlots(jobs, nil, map[string]int{}, now)
	gap := slots[0].SendAt.Sub(lastSend)
	if gap < 8*time.Minute {
		t.Fatalf("gap = %s, want about 9m", gap)
	}
}

func TestPacerFirstSendIsImmediate(t *testing.T) {
	now := time.Now()
	jobs := []types.SendJob{{MailboxID: "mb-1"}}

	slots := testPacer().ComputeSlots(jobs, nil, map[string]int{}, now)
	if !slots[0].Allowed {
		t.Fatalf("slot should be allowed: %s", slots[0].Reason)
	}
	if slots[0].SendAt.Sub(now) > time.Second {
		t.Fatalf("the first send should not be delayed, got %s", slots[0].SendAt.Sub(now))
	}
}

func TestPacerRespectsTheDailyCap(t *testing.T) {
	now := time.Now()
	jobs := []types.SendJob{{MailboxID: "mb-1"}}

	stats := map[string]*types.DailyStats{
		"mb-1": {MailboxID: "mb-1", Sent: 30},
	}

	slots := testPacer().ComputeSlots(jobs, stats, map[string]int{}, now)
	if slots[0].Allowed {
		t.Fatal("the slot should be blocked once the daily cap is reached")
	}
	if slots[0].Reason != "daily_cap_exceeded" {
		t.Fatalf("reason = %q", slots[0].Reason)
	}
}

func TestPacerUsesTheCampaignJitter(t *testing.T) {
	// The gap is a minimum, not a fixed offset: when enough time has
	// already passed, the send happens now. Starting from "just sent",
	// the slot must land exactly on the gap boundary when there is no
	// jitter.
	now := time.Now()
	lastSend := now

	jobs := []types.SendJob{{
		MailboxID:         "mb-1",
		EmailGapMinutes:   1,
		RandomWaitMax:     0,
		LastMailboxSendAt: &lastSend,
	}}

	slots := testPacer().ComputeSlots(jobs, nil, map[string]int{}, now)
	if got := slots[0].SendAt.Sub(lastSend); got != time.Minute {
		t.Fatalf("gap = %s, want exactly 1m", got)
	}
}

func TestPacerJitterStaysInsideTheCampaignWindow(t *testing.T) {
	now := time.Now()
	lastSend := now

	jobs := []types.SendJob{{
		MailboxID:         "mb-1",
		EmailGapMinutes:   1,
		RandomWaitMax:     1, // up to one minute of jitter
		LastMailboxSendAt: &lastSend,
	}}

	slots := testPacer().ComputeSlots(jobs, nil, map[string]int{}, now)
	gap := slots[0].SendAt.Sub(lastSend)
	if gap < time.Minute || gap > 2*time.Minute {
		t.Fatalf("gap = %s, want between 1m and 2m", gap)
	}
}

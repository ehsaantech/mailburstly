package pacing

import (
	"math/rand"
	"time"

	"github.com/mailrung/dispatcher/internal/types"
)

// Pacer enforces per-mailbox pacing: daily quota, min-gap, and random jitter.
type Pacer struct {
	MinGapSeconds       int
	RandomJitterSeconds int
	DefaultMailboxCap   int
	HardMailboxCap      int
}

// MailboxSlot represents the next available send slot for a mailbox.
type MailboxSlot struct {
	MailboxID string
	SendAt    time.Time
	Allowed   bool
	Reason    string
}

// ComputeSlots takes a list of claimed jobs grouped by mailbox and returns
// the send slot for each, respecting quota, min-gap, and jitter.
func (p *Pacer) ComputeSlots(
	jobs []types.SendJob,
	dailyStats map[string]*types.DailyStats,
	inFlight map[string]int,
	now time.Time,
) []MailboxSlot {
	// Group jobs by mailbox.
	byMailbox := make(map[string][]types.SendJob)
	for _, j := range jobs {
		byMailbox[j.MailboxID] = append(byMailbox[j.MailboxID], j)
	}

	var slots []MailboxSlot
	for mailboxID, mailboxJobs := range byMailbox {
		stats, ok := dailyStats[mailboxID]
		if !ok {
			stats = &types.DailyStats{MailboxID: mailboxID}
		}

		cap := p.DefaultMailboxCap
		if cap > p.HardMailboxCap {
			cap = p.HardMailboxCap
		}

		for _, job := range mailboxJobs {
			slot := MailboxSlot{MailboxID: mailboxID}

			// The campaign owns its pacing. The dispatcher's settings are
			// a floor: they can make sending more conservative, never
			// less. A campaign that asks for one minute between sends
			// gets one minute, unless the operator has set a stricter
			// global floor.
			gapSeconds := job.EmailGapMinutes * 60
			if p.MinGapSeconds > gapSeconds {
				gapSeconds = p.MinGapSeconds
			}

			jitterSeconds := job.RandomWaitMax * 60
			if jitterSeconds == 0 {
				jitterSeconds = p.RandomJitterSeconds
			}

			// Quota check.
			if stats.Sent+inFlight[mailboxID]+1 > cap {
				slot.Allowed = false
				slot.Reason = "daily_cap_exceeded"
				slots = append(slots, slot)
				continue
			}

			// Min-gap check.
			sendAt := now
			hadPreviousSend := false
			// The gap is per MAILBOX, not per lead: it models how often this
			// sending inbox has talked to the outside world recently.
			if job.LastMailboxSendAt != nil {
				minNext := job.LastMailboxSendAt.Add(time.Duration(gapSeconds) * time.Second)
				if minNext.After(sendAt) {
					sendAt = minNext
				}
				hadPreviousSend = true
			}

			// Random jitter — only when there was a previous send.
			if hadPreviousSend && jitterSeconds > 0 {
				jitter := time.Duration(rand.Intn(jitterSeconds)) * time.Second
				sendAt = sendAt.Add(jitter)
			}

			slot.SendAt = sendAt
			slot.Allowed = true
			slots = append(slots, slot)

			// Track in-flight.
			inFlight[mailboxID]++
		}
	}

	return slots
}

// NextAvailableSlot returns the earliest time a mailbox can send again.
func (p *Pacer) NextAvailableSlot(lastSend *time.Time, now time.Time) time.Time {
	if lastSend == nil {
		return now
	}
	minNext := lastSend.Add(time.Duration(p.MinGapSeconds) * time.Second)
	if minNext.After(now) {
		return minNext
	}
	return now
}

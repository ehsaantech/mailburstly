// Package types holds the shared structs used across the dispatcher.
// These mirror the Postgres schema in packages/db/src/schema/core.ts and the
// enum values in packages/db/src/schema/enums.ts. A schema change that breaks
// the Go side must be caught deliberately, not at runtime.
package types

import "time"

// SendJobState mirrors the send_job_state Postgres enum.
type SendJobState string

const (
	JobPending   SendJobState = "pending"
	JobClaimed   SendJobState = "claimed"
	JobSent      SendJobState = "sent"
	JobSoftBounce SendJobState = "soft_bounced"
	JobHardBounce SendJobState = "hard_bounced"
	JobFailed    SendJobState = "failed"
	JobSkipped   SendJobState = "skipped"
)

// MailboxStatus mirrors the mailbox_status Postgres enum.
type MailboxStatus string

const (
	MailboxConnected   MailboxStatus = "connected"
	MailboxDegraded    MailboxStatus = "degraded"
	MailboxFailed      MailboxStatus = "failed"
	MailboxDisconnected MailboxStatus = "disconnected"
)

// Mailbox is the subset of columns the dispatcher needs.
type Mailbox struct {
	ID            string
	Email         string
	MailcoreID string
	Status        MailboxStatus
	DailyCap      int
	HealthScore   float64
	LastSendAt    *time.Time
}

// SendJob is a row from the send_jobs outbox table.
type SendJob struct {
	ID             string
	CampaignLeadID string
	StepID         string
	MailboxID      string
	ScheduledAt    time.Time
	State          SendJobState
	Attempts       int
	LastError      *string

	// Resolved at claim time by joining campaign_leads → leads → steps →
	// campaigns → mailboxes.
	//
	// MailcoreAccountID is the id of the account inside mailcore — NOT
	// our own mailbox id. The two differ, and sending to the wrong one fails.
	MailcoreAccountID string
	LastSendAt           *time.Time
	// LastMailboxSendAt is the last time THIS MAILBOX sent anything. The
	// min-gap is a per-mailbox reputation signal, so it must not be derived
	// from a per-lead timestamp.
	LastMailboxSendAt *time.Time

	// Lead data, used to render the message body.
	LeadEmail       string
	LeadFirstName   *string
	LeadLastName    *string
	LeadTitle       *string
	LeadCompany     *string
	CustomVariables map[string]string

	CampaignName string
	MailboxEmail string

	// Ids needed to write the activity log.
	WorkspaceID string
	LeadID      string
	CampaignID  string

	// Per-campaign tracking switches, applied to the submission.
	OpenTracking     bool
	LinkTracking     bool
	TextOnly         bool
	UnsubscribeHeader bool

	// Per-campaign pacing. The campaign's own settings win; the
	// dispatcher's defaults are only a fallback.
	EmailGapMinutes int
	RandomWaitMax   int

	StepSubject  *string
	StepBodyHTML string
	StepBodyText *string
	StepDelayMin int
	ThreadMode   string

	VariantID      *string
	VariantSubject *string
	VariantBody    *string
}

// DailyStats is a row from mailbox_daily_stats.
type DailyStats struct {
	MailboxID  string
	Date       string
	Sent       int
	Bounced    int
	Errors     int
}

// MailcoreAccount is the subset of the mailcore account response we need.
type MailcoreAccount struct {
	Account string `json:"account"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	State   string `json:"state"`
	Type    string `json:"type"`
}

// SendResult is what mailcore returns after a submission.
type SendResult struct {
	MessageID string `json:"messageId"`
	QueueID   string `json:"queueId"`
}
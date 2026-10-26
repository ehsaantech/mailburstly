package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mailrung/dispatcher/internal/types"
)

// JobStore handles send_jobs claim and state transitions.
type JobStore struct {
	pool *pgxpool.Pool
}

func NewJobStore(pool *pgxpool.Pool) *JobStore {
	return &JobStore{pool: pool}
}

// jobSelect is the column list every claim query shares. Keeping it in one
// place means the row→struct mapping can only ever be wrong in one spot.
const jobSelect = `
		SELECT
			sj.id,
			sj.campaign_lead_id,
			sj.step_id,
			sj.mailbox_id,
			sj.scheduled_at,
			sj.state,
			sj.attempts,
			sj.last_error,
			m.emailengine_id,
			cl.last_sent_at,
			(SELECT max(sj2.scheduled_at) FROM send_jobs sj2
			 WHERE sj2.mailbox_id = sj.mailbox_id
			   AND sj2.state = 'sent') AS mailbox_last_send,
			l.email,
			l.first_name,
			l.last_name,
			l.title,
			l.company,
			l.custom_variables,
			c.name,
			c.open_tracking,
			c.link_tracking,
			c.email_gap_minutes,
			c.random_wait_max,
			c.text_only,
			c.insert_unsubscribe_header,
			c.workspace_id,
			cl.lead_id,
			cl.campaign_id,
			m.email,
			COALESCE(ss.subject, cs.subject) AS subject,
			COALESCE(ss.body_html, cs.body_html) AS body_html,
			CASE WHEN sj.subsequence_step_id IS NOT NULL THEN NULL
			     ELSE cs.body_text END AS body_text,
			COALESCE(ss.delay_minutes, cs.delay_minutes) AS delay_minutes,
			cs.thread_mode,
			sv.id,
			sv.subject,
			sv.body_html
		FROM send_jobs sj
		JOIN campaign_leads cl ON cl.id = sj.campaign_lead_id
		JOIN campaigns c ON c.id = cl.campaign_id
		JOIN leads l ON l.id = cl.lead_id
		JOIN campaign_steps cs ON cs.id = sj.step_id
		JOIN mailboxes m ON m.id = sj.mailbox_id
		LEFT JOIN step_variants sv ON sv.id = sj.variant_id
		LEFT JOIN campaign_subsequence_steps ss ON ss.id = sj.subsequence_step_id
`

// ClaimDue atomically claims up to batchSize pending jobs whose scheduled_at
// has passed, using FOR UPDATE OF sj SKIP LOCKED so multiple dispatcher replicas
// never contend. Returns the claimed jobs with their joined lead/step data.
func (s *JobStore) ClaimDue(ctx context.Context, batchSize int) ([]types.SendJob, error) {
	jobs, err := s.selectJobs(ctx, `
		WHERE sj.state = 'pending'
		  AND sj.scheduled_at <= now()
		ORDER BY sj.scheduled_at
		FOR UPDATE OF sj SKIP LOCKED
		LIMIT $1
	`, batchSize)
	if err != nil {
		return nil, fmt.Errorf("claim due: %w", err)
	}

	// Mark claimed.
	for i := range jobs {
		_, err := s.pool.Exec(ctx, `
			UPDATE send_jobs SET state = 'claimed', attempts = attempts + 1
			WHERE id = $1 AND state = 'pending'
		`, jobs[i].ID)
		if err != nil {
			return nil, fmt.Errorf("mark claimed %s: %w", jobs[i].ID, err)
		}
	}

	return jobs, nil
}

// selectJobs runs a claim-shaped query and maps the rows onto SendJob. The
// tail of the query (WHERE / ORDER BY / LIMIT) is supplied by the caller so
// that tests can target a single job without making it claimable by the
// running dispatcher.
func (s *JobStore) selectJobs(ctx context.Context, tail string, args ...any) ([]types.SendJob, error) {
	rows, err := s.pool.Query(ctx, jobSelect+tail, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []types.SendJob
	for rows.Next() {
		var j types.SendJob
		// Every nullable column is scanned into a local pointer first, then
		// copied onto the struct. Scanning straight into the struct and then
		// re-assigning from the locals silently nulls the fields.
		var firstName, lastName, title, company *string
		var subject, bodyText *string
		var variantIDVal, variantSubject, variantBody *string
		var lastError *string
		var lastSend *time.Time
		var mailboxLastSend *time.Time
		var customVars map[string]any
		var campaignName, mailboxEmail string
		var workspaceID, leadID, campaignID string
		var openTracking, linkTracking, textOnly, unsubHeader bool
		var emailGapMinutes, randomWaitMax int
		err := rows.Scan(
			&j.ID, &j.CampaignLeadID, &j.StepID, &j.MailboxID,
			&j.ScheduledAt, &j.State, &j.Attempts, &lastError,
			&j.EmailEngineAccountID,
			&lastSend,
			&mailboxLastSend,
			&j.LeadEmail, &firstName, &lastName, &title, &company,
			&customVars, &campaignName, &openTracking, &linkTracking,
			&emailGapMinutes, &randomWaitMax, &textOnly, &unsubHeader,
			&workspaceID, &leadID, &campaignID, &mailboxEmail,
			&subject, &j.StepBodyHTML, &bodyText,
			&j.StepDelayMin, &j.ThreadMode,
			&variantIDVal, &variantSubject, &variantBody,
		)
		if err != nil {
			return nil, fmt.Errorf("scan job: %w", err)
		}
		j.LastError = lastError
		j.LastSendAt = lastSend
		j.LastMailboxSendAt = mailboxLastSend
		j.LeadFirstName = firstName
		j.LeadLastName = lastName
		j.LeadTitle = title
		j.LeadCompany = company
		j.StepSubject = subject
		j.StepBodyText = bodyText
		j.CampaignName = campaignName
		j.OpenTracking = openTracking
		j.EmailGapMinutes = emailGapMinutes
		j.RandomWaitMax = randomWaitMax
		j.LinkTracking = linkTracking
		j.TextOnly = textOnly
		j.UnsubscribeHeader = unsubHeader
		j.WorkspaceID = workspaceID
		j.LeadID = leadID
		j.CampaignID = campaignID
		j.MailboxEmail = mailboxEmail
		j.CustomVariables = stringMap(customVars)
		j.VariantID = variantIDVal
		j.VariantSubject = variantSubject
		j.VariantBody = variantBody
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows err: %w", err)
	}

	return jobs, nil
}

// MarkSent transitions a job to sent.
func (s *JobStore) MarkSent(ctx context.Context, jobID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE send_jobs SET state = 'sent' WHERE id = $1
	`, jobID)
	return err
}

// MarkFailed transitions a job to failed with an error message.
func (s *JobStore) MarkFailed(ctx context.Context, jobID string, errMsg string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE send_jobs SET state = 'failed', last_error = $2 WHERE id = $1
	`, jobID, errMsg)
	return err
}

// MarkSkipped transitions a job to skipped (blocklisted, unsubscribed, etc.).
func (s *JobStore) MarkSkipped(ctx context.Context, jobID string, reason string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE send_jobs SET state = 'skipped', last_error = $2 WHERE id = $1
	`, jobID, reason)
	return err
}

// ReclaimStale reclaims jobs stuck in 'claimed' past the lease timeout.
func (s *JobStore) ReclaimStale(ctx context.Context, leaseTimeout time.Duration) (int, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE send_jobs
		SET state = 'pending', last_error = 'reclaimed: lease expired'
		WHERE state = 'claimed'
		  AND updated_at < now() - $1::interval
	`, leaseTimeout.String())
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// AdvanceLead moves a campaign_lead to the next step after a successful send.
//
// If there is no next step, the lead is marked completed. The wait before the
// next step comes from the NEXT step's delay, not the one just sent — the delay
// on a step is the wait that precedes it.
func (s *JobStore) AdvanceLead(ctx context.Context, campaignLeadID, stepID string, delayMinutes int) error {
	var nextStepID *string
	var nextDelay *int

	err := s.pool.QueryRow(ctx, `
		SELECT cs.id, cs.delay_minutes
		FROM campaign_steps cs
		JOIN campaign_leads cl ON cl.campaign_id = cs.campaign_id
		WHERE cl.id = $1
		  AND cs.position > (SELECT position FROM campaign_steps WHERE id = $2)
		ORDER BY cs.position
		LIMIT 1
	`, campaignLeadID, stepID).Scan(&nextStepID, &nextDelay)
	if err != nil && err != pgx.ErrNoRows {
		return err
	}

	if nextStepID == nil {
		_, err = s.pool.Exec(ctx, `
			UPDATE campaign_leads
			SET current_step_id = NULL,
			    next_step_at = NULL,
			    state = 'completed',
			    completed_at = now(),
			    last_sent_at = now()
			WHERE id = $1
		`, campaignLeadID)
		return err
	}

	wait := delayMinutes
	if nextDelay != nil {
		wait = *nextDelay
	}

	_, err = s.pool.Exec(ctx, `
		UPDATE campaign_leads
		SET current_step_id = $2,
		    next_step_at = now() + ($3 || ' minutes')::interval,
		    last_sent_at = now()
		WHERE id = $1
	`, campaignLeadID, *nextStepID, wait)
	return err
}

// RecordActivity appends a row to the activities log.
func (s *JobStore) RecordActivity(ctx context.Context, workspaceID, campaignID, leadID, mailboxID, stepID, variantID *string, activityType string, meta map[string]any) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO activities (workspace_id, campaign_id, lead_id, mailbox_id, step_id, variant_id, type, meta, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
	`, workspaceID, campaignID, leadID, mailboxID, stepID, variantID, activityType, meta)
	return err
}

// RecordSentMessage stores the Message-ID of a message we just sent.
//
// This is the join key for everything that comes back later: a bounce, a
// complaint, an unsubscribe. EmailEngine does not use VERP, so the
// Message-ID is the only reliable link between a send and its consequences.
func (s *JobStore) RecordSentMessage(ctx context.Context, j *types.SendJob, messageID, subject string) error {
	if messageID == "" {
		return nil
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO sent_messages (
			workspace_id, message_id, original_message_id, lead_id, campaign_id,
			mailbox_id, step_id, variant_id, recipient, subject, sent_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
		ON CONFLICT (message_id) DO NOTHING
	`,
		j.WorkspaceID, messageID, messageID, j.LeadID, j.CampaignID,
		j.MailboxID, j.StepID, j.VariantID, j.LeadEmail, subject,
	)
	return err
}

// MarkLeadInvalid marks a lead as invalid (hard bounce).
func (s *JobStore) MarkLeadInvalid(ctx context.Context, leadID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE leads SET email_status = 'invalid' WHERE id = $1
	`, leadID)
	return err
}

// AddToBlocklist adds an email to the global blocklist.
func (s *JobStore) AddToBlocklist(ctx context.Context, email string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO blocklist (type, value, source, created_at)
		VALUES ('email', $1, 'hard_bounce', now())
		ON CONFLICT DO NOTHING
	`, email)
	return err
}

// IsBlocklisted checks if an email or its domain is on the blocklist.
func (s *JobStore) IsBlocklisted(ctx context.Context, email string) (bool, error) {
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM blocklist
		WHERE value = $1
		   OR (type = 'domain' AND $1 LIKE '%@' || value)
	`, email).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// MailboxStore handles mailbox reads and daily stats.
type MailboxStore struct {
	pool *pgxpool.Pool
}

func NewMailboxStore(pool *pgxpool.Pool) *MailboxStore {
	return &MailboxStore{pool: pool}
}

// Get fetches a mailbox by ID.
func (s *MailboxStore) Get(ctx context.Context, id string) (*types.Mailbox, error) {
	var m types.Mailbox
	var lastSend *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, emailengine_id, status, daily_cap, health_score, last_send_at
		FROM mailboxes WHERE id = $1
	`, id).Scan(&m.ID, &m.Email, &m.EmailEngineID, &m.Status, &m.DailyCap, &m.HealthScore, &lastSend)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

// GetDailyStats fetches today's stats for a mailbox.
func (s *MailboxStore) GetDailyStats(ctx context.Context, mailboxID, date string) (*types.DailyStats, error) {
	var st types.DailyStats
	err := s.pool.QueryRow(ctx, `
		SELECT mailbox_id, date, sent, bounced, errors
		FROM mailbox_daily_stats
		WHERE mailbox_id = $1 AND date = $2
	`, mailboxID, date).Scan(&st.MailboxID, &st.Date, &st.Sent, &st.Bounced, &st.Errors)
	if err != nil {
		if err == pgx.ErrNoRows {
			return &types.DailyStats{MailboxID: mailboxID, Date: date}, nil
		}
		return nil, err
	}
	return &st, nil
}

// IncrementSent increments the sent counter for a mailbox today.
func (s *MailboxStore) IncrementSent(ctx context.Context, mailboxID, date string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO mailbox_daily_stats (mailbox_id, date, sent, bounced, errors, updated_at)
		VALUES ($1, $2, 1, 0, 0, now())
		ON CONFLICT (mailbox_id, date) DO UPDATE SET
			sent = mailbox_daily_stats.sent + 1,
			updated_at = now()
	`, mailboxID, date)
	return err
}

// InFlightCount returns the number of claimed jobs for a mailbox today.
func (s *MailboxStore) InFlightCount(ctx context.Context, mailboxID, date string) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM send_jobs
		WHERE mailbox_id = $1
		  AND state = 'claimed'
		  AND scheduled_at::date = $2::date
	`, mailboxID, date).Scan(&count)
	return count, err
}

// LastSendTime returns the most recent send time for a mailbox.
func (s *MailboxStore) LastSendTime(ctx context.Context, mailboxID string) (*time.Time, error) {
	var lastSend *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT max(last_sent_at) FROM campaign_leads
		WHERE mailbox_id = $1
	`, mailboxID).Scan(&lastSend)
	// campaign_leads doesn't have mailbox_id; use send_jobs instead
	if err != nil {
		return nil, err
	}
	// Fallback: query send_jobs for the most recent claimed/sent job
	var lastJob *time.Time
	err = s.pool.QueryRow(ctx, `
		SELECT max(scheduled_at) FROM send_jobs
		WHERE mailbox_id = $1 AND state IN ('claimed', 'sent')
	`, mailboxID).Scan(&lastJob)
	if err != nil {
		return nil, err
	}
	return lastJob, nil
}
// stringMap flattens a jsonb custom-variables object into strings. Values
// that are not strings are rendered with their JSON representation.
func stringMap(in map[string]any) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		switch t := v.(type) {
		case string:
			out[k] = t
		case nil:
			out[k] = ""
		case float64:
			out[k] = strconv.FormatFloat(t, 'f', -1, 64)
		case bool:
			out[k] = strconv.FormatBool(t)
		default:
			b, err := json.Marshal(t)
			if err == nil {
				out[k] = string(b)
			}
		}
	}
	return out
}

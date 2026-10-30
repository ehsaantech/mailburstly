package store

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mailrung/dispatcher/internal/types"
)

// testPool returns a pool against the dev database, or skips the test when
// the database is not reachable. These are integration tests: they need the
// schema, but they must not fail the build on a machine without it.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://mailrung:change-me-postgres@localhost:5433/mailrung"
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("database unavailable: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("database unavailable: %v", err)
	}
	return pool
}

// fixture holds the ids of a throwaway campaign used by the tests.
type fixture struct {
	workspaceID  string
	mailboxID    string
	campaignID   string
	stepID       string
	leadID       string
	campaignLead string
	jobID        string
}

// seed inserts a minimal campaign with one step, one lead and one pending
// send job. Everything is removed on cleanup.
func seed(t *testing.T, pool *pgxpool.Pool) *fixture {
	t.Helper()
	ctx := context.Background()

	f := &fixture{}

	// Reuse the first workspace and connected mailbox that exist; both are
	// required by the foreign keys.
	err := pool.QueryRow(ctx, `SELECT id FROM workspaces LIMIT 1`).Scan(&f.workspaceID)
	if err != nil {
		t.Skipf("no workspace to build a fixture from: %v", err)
	}
	err = pool.QueryRow(ctx, `
		SELECT id FROM mailboxes WHERE status = 'connected' LIMIT 1
	`).Scan(&f.mailboxID)
	if err != nil {
		t.Skipf("no connected mailbox to build a fixture from: %v", err)
	}

	err = pool.QueryRow(ctx, `
		INSERT INTO leads (workspace_id, email, first_name, last_name, company, title, custom_variables)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
		RETURNING id
	`, f.workspaceID,
		fmt.Sprintf("store-test-%d@example.com", time.Now().UnixNano()), "Zahid", "Khan", "Northwind Labs", "Head of Growth",
		`{"industry":"SaaS"}`,
	).Scan(&f.leadID)
	if err != nil {
		t.Fatalf("insert lead: %v", err)
	}

	// Draft, so the scheduler never touches it.
	err = pool.QueryRow(ctx, `
		INSERT INTO campaigns (workspace_id, name, status)
		VALUES ($1, 'store test campaign', 'draft')
		RETURNING id
	`, f.workspaceID).Scan(&f.campaignID)
	if err != nil {
		t.Fatalf("insert campaign: %v", err)
	}

	err = pool.QueryRow(ctx, `
		INSERT INTO campaign_steps (campaign_id, position, subject, body_html, body_text, delay_minutes)
		VALUES ($1, 1, $2, $3, $4, 0)
		RETURNING id
	`, f.campaignID,
		"{{company}} — a question for {{first_name}}",
		"Hi {{first_name}}, {{industry}} at {{company}}.",
		"Hi {{first_name}}, {{industry}} at {{company}}.",
	).Scan(&f.stepID)
	if err != nil {
		t.Fatalf("insert step: %v", err)
	}

	err = pool.QueryRow(ctx, `
		INSERT INTO campaign_leads (campaign_id, lead_id, current_step_id, state, next_step_at)
		VALUES ($1, $2, $3, 'active', now() - interval '1 minute')
		RETURNING id
	`, f.campaignID, f.leadID, f.stepID).Scan(&f.campaignLead)
	if err != nil {
		t.Fatalf("insert campaign_lead: %v", err)
	}

	err = pool.QueryRow(ctx, `
		INSERT INTO send_jobs (campaign_lead_id, step_id, mailbox_id, scheduled_at, state)
		VALUES ($1, $2, $3, now() + interval '1 day', 'pending')
		RETURNING id
	`, f.campaignLead, f.stepID, f.mailboxID).Scan(&f.jobID)
	if err != nil {
		t.Fatalf("insert send job: %v", err)
	}

	t.Cleanup(func() {
		// Cascade takes care of the job, the campaign lead, the step and
		// the campaign.
		_, _ = pool.Exec(context.Background(), `DELETE FROM campaigns WHERE id = $1`, f.campaignID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM leads WHERE id = $1`, f.leadID)
	})

	return f
}

// TestClaimDuePopulatesTemplateFields is the regression guard for a bug where
// the claim scan wrote the step subject and the lead first name into the
// struct and then immediately overwrote them with locals that were never
// populated — so every send went out with an empty subject and no
// personalization.
func TestClaimDuePopulatesTemplateFields(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	f := seed(t, pool)
	ctx := context.Background()

	// The job is scheduled a day out, so the running dispatcher cannot pick
	// it up. The test selects it by id through the same row→struct mapping
	// that ClaimDue uses.
	jobs, err := NewJobStore(pool).selectJobs(ctx, `
		WHERE sj.id = $1
	`, f.jobID)
	if err != nil {
		t.Fatalf("select job: %v", err)
	}

	var j *types.SendJob
	for i := range jobs {
		if jobs[i].ID == f.jobID {
			j = &jobs[i]
			break
		}
	}
	if j == nil {
		t.Fatalf("seeded job %s was not selected", f.jobID)
	}

	if j.StepSubject == nil || *j.StepSubject == "" {
		t.Fatal("step subject must be populated on the claimed job")
	}
	if want := "{{company}} — a question for {{first_name}}"; *j.StepSubject != want {
		t.Fatalf("subject = %q want %q", *j.StepSubject, want)
	}
	if j.LeadFirstName == nil || *j.LeadFirstName != "Zahid" {
		t.Fatalf("lead first name = %v want Zahid", j.LeadFirstName)
	}
	if j.LeadLastName == nil || *j.LeadLastName != "Khan" {
		t.Fatalf("lead last name = %v want Khan", j.LeadLastName)
	}
	if j.LeadCompany == nil || *j.LeadCompany != "Northwind Labs" {
		t.Fatalf("lead company = %v want Northwind Labs", j.LeadCompany)
	}
	if j.LeadTitle == nil || *j.LeadTitle != "Head of Growth" {
		t.Fatalf("lead title = %v want Head of Growth", j.LeadTitle)
	}
	if j.StepBodyHTML == "" {
		t.Fatal("step body must be populated")
	}
	if j.CampaignName != "store test campaign" {
		t.Fatalf("campaign name = %q", j.CampaignName)
	}
	if j.MailboxEmail == "" {
		t.Fatal("mailbox email must be populated")
	}
	if j.CustomVariables["industry"] != "SaaS" {
		t.Fatalf("custom variables = %v", j.CustomVariables)
	}
	if j.MailcoreAccountID == "" {
		t.Fatal("mailcore account id must be populated")
	}
}

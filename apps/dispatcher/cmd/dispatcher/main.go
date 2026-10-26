package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mailrung/dispatcher/internal/config"
	"github.com/mailrung/dispatcher/internal/db"
	"github.com/mailrung/dispatcher/internal/pacing"
	"github.com/mailrung/dispatcher/internal/render"
	"github.com/mailrung/dispatcher/internal/sender"
	"github.com/mailrung/dispatcher/internal/server"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mailrung/dispatcher/internal/store"
	"github.com/mailrung/dispatcher/internal/types"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx := context.Background()

	pool, err := db.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()

	jobStore := store.NewJobStore(pool.Pool)
	mailboxStore := store.NewMailboxStore(pool.Pool)
	pacer := &pacing.Pacer{
		MinGapSeconds:       cfg.MinGapSeconds,
		RandomJitterSeconds: cfg.RandomJitterSeconds,
		DefaultMailboxCap:   cfg.DefaultMailboxCap,
		HardMailboxCap:      cfg.HardMailboxCap,
	}
	emailEngine := sender.New(cfg.EmailEngineURL, cfg.EmailEngineSecret)

	srv := server.New(func() (map[string]any, error) {
		if err := pool.Ping(ctx); err != nil {
			return map[string]any{"status": "error", "checks": map[string]string{"database": "error"}}, err
		}
		return map[string]any{"status": "ok", "checks": map[string]string{"database": "ok"}}, nil
	})

	// Start HTTP server.
	go func() {
		addr := fmt.Sprintf(":%d", cfg.Port)
		log.Printf("dispatcher listening on %s", addr)
		if err := srv.ListenAndServe(addr); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http: %v", err)
		}
	}()

	// Main dispatch loop.
	go func() {
		ticker := time.NewTicker(cfg.PollInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				runDispatchCycle(ctx, pool.Pool, jobStore, mailboxStore, pacer, emailEngine, cfg)
			case <-ctx.Done():
				return
			}
		}
	}()

	// Graceful shutdown.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	<-sigCh
	log.Println("shutting down")
}

func runDispatchCycle(
	ctx context.Context,
	pool *pgxpool.Pool,
	jobs *store.JobStore,
	mailboxes *store.MailboxStore,
	pacer *pacing.Pacer,
	ee *sender.EmailEngineClient,
	cfg config.Config,
) {
	log.Printf("dispatch cycle tick")
	// 1. Reclaim stale claimed jobs (lease timeout 10 min).
	reclaimed, err := jobs.ReclaimStale(ctx, 10*time.Minute)
	if err != nil {
		log.Printf("reclaim stale: %v", err)
	} else if reclaimed > 0 {
		log.Printf("reclaimed %d stale jobs", reclaimed)
	}

	// 2. Claim due jobs.
	claimed, err := jobs.ClaimDue(ctx, cfg.BatchSize)
	if err != nil {
		log.Printf("claim due: %v", err)
		return
	}
	if len(claimed) == 0 {
		return
	}

	// 3. Load mailbox state for pacing.
	now := time.Now()
	dailyStats := make(map[string]*types.DailyStats)
	inFlight := make(map[string]int)

	for _, job := range claimed {
		if _, ok := dailyStats[job.MailboxID]; !ok {
			date := now.Format("2006-01-02")
			st, err := mailboxes.GetDailyStats(ctx, job.MailboxID, date)
			if err != nil {
				log.Printf("get daily stats %s: %v", job.MailboxID, err)
				st = &types.DailyStats{MailboxID: job.MailboxID, Date: date}
			}
			dailyStats[job.MailboxID] = st
		}
		if _, ok := inFlight[job.MailboxID]; !ok {
			count, err := mailboxes.InFlightCount(ctx, job.MailboxID, now.Format("2006-01-02"))
			if err != nil {
				log.Printf("in-flight count %s: %v", job.MailboxID, err)
				count = 0
			}
			inFlight[job.MailboxID] = count
		}
	}

	// 4. Compute pacing slots.
	slots := pacer.ComputeSlots(claimed, dailyStats, inFlight, now)

	// 5. Submit due jobs.
	for i, job := range claimed {
		slot := slots[i]
		if !slot.Allowed {
			if err := jobs.MarkSkipped(ctx, job.ID, slot.Reason); err != nil {
				log.Printf("mark skipped %s: %v", job.ID, err)
			}
			continue
		}

		// If the slot is in the future, rewrite scheduled_at and skip this tick.
		if slot.SendAt.After(now) {
			// Update scheduled_at to the paced slot.
			// Put it back to 'pending' — leaving it 'claimed' would hold the
			// lease and make the next cycle skip it.
			_, err := pool.Exec(ctx, `
				UPDATE send_jobs SET scheduled_at = $2, state = 'pending'
				WHERE id = $1
			`, job.ID, slot.SendAt)
			if err != nil {
				log.Printf("reschedule %s: %v", job.ID, err)
			}
			continue
		}

		// Blocklist check.
		blocked, err := jobs.IsBlocklisted(ctx, job.LeadEmail)
		if err != nil {
			log.Printf("blocklist check %s: %v", job.ID, err)
			continue
		}
		if blocked {
			if err := jobs.MarkSkipped(ctx, job.ID, "blocklisted"); err != nil {
				log.Printf("mark skipped %s: %v", job.ID, err)
			}
			continue
		}

		// Render once for the audit log, then submit (which renders again).
		// Cheap, and it makes "what did we actually send" answerable from logs.
		renderedSubject := ""
		if job.StepSubject != nil {
			renderedSubject = render.Render(*job.StepSubject, sender.BuildRenderData(&job), render.Options{EnableSpintax: true})
		}

		// Submit to EmailEngine.
		result, err := ee.SubmitMessage(&job)
		if err != nil {
			log.Printf("submit %s: %v", job.ID, err)
			if err := jobs.MarkFailed(ctx, job.ID, err.Error()); err != nil {
				log.Printf("mark failed %s: %v", job.ID, err)
			}
			continue
		}

		// Mark sent.
		if err := jobs.MarkSent(ctx, job.ID); err != nil {
			log.Printf("mark sent %s: %v", job.ID, err)
			continue
		}

		// Record the Message-ID so a bounce can be attributed back to this
		// lead. This must happen before anything else that could fail.
		if err := jobs.RecordSentMessage(ctx, &job, result.MessageID, renderedSubject); err != nil {
			log.Printf("record sent message %s: %v", job.ID, err)
		}

		// Record activity.
		workspaceID := job.WorkspaceID
		campaignID := job.CampaignID
		leadID := job.LeadID
		mailboxID := job.MailboxID
		stepID := job.StepID
		variantID := job.VariantID
		meta := map[string]any{"messageId": result.MessageID, "to": job.LeadEmail}
		if err := jobs.RecordActivity(ctx, &workspaceID, &campaignID, &leadID, &mailboxID, &stepID, variantID, "email_sent", meta); err != nil {
			log.Printf("record activity %s: %v", job.ID, err)
		}

		// Advance lead to next step.
		if err := jobs.AdvanceLead(ctx, job.CampaignLeadID, job.StepID, job.StepDelayMin); err != nil {
			log.Printf("advance lead %s: %v", job.ID, err)
		}

		// Increment mailbox daily stats.
		date := now.Format("2006-01-02")
		if err := mailboxes.IncrementSent(ctx, job.MailboxID, date); err != nil {
			log.Printf("increment sent %s: %v", job.ID, err)
		}

		log.Printf("sent %s to %s via %s | subject=%q", job.ID, job.LeadEmail, job.MailboxID, renderedSubject)
	}
}
package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var schema = `
CREATE TABLE IF NOT EXISTS mail_accounts (
  id                text PRIMARY KEY,
  email             text NOT NULL,
  display_name      text,
  provider          text NOT NULL,
  settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL,
  scopes            text[] NOT NULL DEFAULT '{}',
  access_token_enc  text,
  refresh_token_enc text NOT NULL,
  key_version       int  NOT NULL DEFAULT 1,
  access_expires_at timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mail_oauth_states (
  state         text PRIMARY KEY,
  account_id    text NOT NULL,
  provider      text NOT NULL,
  code_verifier text NOT NULL,
  redirect_to   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  used_at       timestamptz
);
CREATE TABLE IF NOT EXISTS mail_sync_state (
  account_id    text PRIMARY KEY REFERENCES mail_accounts(id) ON DELETE CASCADE,
  cursor        text,
  last_sync_at  timestamptz,
  last_error    text
);
CREATE TABLE IF NOT EXISTS mail_messages (
  id             text PRIMARY KEY,
  account_id     text NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  provider_id    text NOT NULL,
  rfc_message_id text,
  thread_id      text,
  folder         text NOT NULL DEFAULT 'INBOX',
  direction      text NOT NULL,
  internal_date  timestamptz,
  subject        text,
  from_addr      text,
  to_addr        text,
  UNIQUE (account_id, provider_id)
);
CREATE TABLE IF NOT EXISTS mail_events (
  id               text PRIMARY KEY,
  account_id       text,
  event            text NOT NULL,
  payload          jsonb NOT NULL,
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mail_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_quota (
  account_id text NOT NULL,
  day date NOT NULL,
  sent int NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day)
);
`

type Store struct {
	Pool *pgxpool.Pool
}

func New(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	s := &Store{Pool: pool}
	if err := s.Migrate(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Migrate(ctx context.Context) error {
	_, err := s.Pool.Exec(ctx, schema)
	return err
}

func (s *Store) Close() { s.Pool.Close() }

// -- accounts --

type AccountRow struct {
	ID              string
	Email           string
	DisplayName     string
	Provider        string
	Settings        string
	Status          string
	Scopes          []string
	AccessTokEnc    string
	RefreshTokEnc   string
	KeyVersion      int
	AccessExpiresAt *time.Time
	LastError       string
}

func (s *Store) UpsertAccount(ctx context.Context, a AccountRow) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO mail_accounts (id,email,display_name,provider,status,settings,scopes,access_token_enc,refresh_token_enc,key_version,access_expires_at,last_error,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,now())
		ON CONFLICT (id) DO UPDATE SET
		  email=$2,display_name=$3,provider=$4,status=$5,settings=$6::jsonb,scopes=$7,access_token_enc=$8,refresh_token_enc=$9,key_version=$10,access_expires_at=$11,last_error=$12,updated_at=now()
	`, a.ID, a.Email, nullable(a.DisplayName), a.Provider, a.Status, nonemptyJSON(a.Settings), a.Scopes, nullable(a.AccessTokEnc), a.RefreshTokEnc, a.KeyVersion, a.AccessExpiresAt, nullable(a.LastError))
	return err
}

func (s *Store) GetAccount(ctx context.Context, id string) (*AccountRow, error) {
	row := s.Pool.QueryRow(ctx, `
		SELECT id,email,display_name,provider,status,settings,scopes,access_token_enc,refresh_token_enc,key_version,access_expires_at,last_error
		FROM mail_accounts WHERE id=$1`, id)
	var r AccountRow
	var dn, ae, le, settings *string
	var scopes []string
	err := row.Scan(&r.ID, &r.Email, &dn, &r.Provider, &r.Status, &settings, &scopes, &ae, &r.RefreshTokEnc, &r.KeyVersion, &r.AccessExpiresAt, &le)
	if err != nil {
		return nil, err
	}
	if dn != nil {
		r.DisplayName = *dn
	}
	if settings != nil {
		r.Settings = *settings
	}
	if ae != nil {
		r.AccessTokEnc = *ae
	}
	if le != nil {
		r.LastError = *le
	}
	r.Scopes = scopes
	return &r, nil
}

func (s *Store) ListAccounts(ctx context.Context) ([]AccountRow, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id,email,display_name,provider,status,settings,scopes,access_token_enc,refresh_token_enc,key_version,access_expires_at,last_error
		FROM mail_accounts ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AccountRow
	for rows.Next() {
		var r AccountRow
		var dn, ae, le, settings *string
		var scopes []string
		if err := rows.Scan(&r.ID, &r.Email, &dn, &r.Provider, &r.Status, &settings, &scopes, &ae, &r.RefreshTokEnc, &r.KeyVersion, &r.AccessExpiresAt, &le); err != nil {
			return nil, err
		}
		if dn != nil {
			r.DisplayName = *dn
		}
		if settings != nil {
			r.Settings = *settings
		}
		if ae != nil {
			r.AccessTokEnc = *ae
		}
		if le != nil {
			r.LastError = *le
		}
		r.Scopes = scopes
		out = append(out, r)
	}
	return out, nil
}

func (s *Store) DeleteAccount(ctx context.Context, id string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM mail_accounts WHERE id=$1`, id)
	return err
}

func (s *Store) SetAccountStatus(ctx context.Context, id, status, lastErr string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE mail_accounts SET status=$2, last_error=$3, updated_at=now() WHERE id=$1`, id, status, nullable(lastErr))
	return err
}

func (s *Store) UpdateTokens(ctx context.Context, id, accessEnc, refreshEnc string, expires int64) error {
	_, err := s.Pool.Exec(ctx, `UPDATE mail_accounts SET access_token_enc=$2, refresh_token_enc=CASE WHEN $3<>'' THEN $3 ELSE refresh_token_enc END, access_expires_at=to_timestamp($4), updated_at=now() WHERE id=$1`,
		id, nullable(accessEnc), refreshEnc, expires)
	return err
}

// -- oauth states --

func (s *Store) SaveOAuthState(ctx context.Context, st map[string]any) error {
	b, _ := json.Marshal(st)
	_ = b
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO mail_oauth_states (state,account_id,provider,code_verifier,redirect_to) VALUES ($1,$2,$3,$4,$5)`,
		st["state"], st["account_id"], st["provider"], st["code_verifier"], st["redirect_to"])
	return err
}

func (s *Store) GetOAuthState(ctx context.Context, state string) (map[string]any, error) {
	row := s.Pool.QueryRow(ctx, `SELECT account_id,provider,code_verifier,redirect_to,used_at FROM mail_oauth_states WHERE state=$1`, state)
	var acc, prov, cv, rt string
	var used *time.Time
	if err := row.Scan(&acc, &prov, &cv, &rt, &used); err != nil {
		return nil, err
	}
	if used != nil {
		return nil, fmt.Errorf("state already used")
	}
	_, _ = s.Pool.Exec(ctx, `UPDATE mail_oauth_states SET used_at=now() WHERE state=$1`, state)
	return map[string]any{"state": state, "account_id": acc, "provider": prov, "code_verifier": cv, "redirect_to": rt}, nil
}

// -- sync state --

func (s *Store) GetSyncCursor(ctx context.Context, id string) (string, error) {
	row := s.Pool.QueryRow(ctx, `SELECT cursor FROM mail_sync_state WHERE account_id=$1`, id)
	var c *string
	if err := row.Scan(&c); err != nil {
		return "", nil
	}
	if c == nil {
		return "", nil
	}
	return *c, nil
}
func (s *Store) SetSyncCursor(ctx context.Context, id, cursor string) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO mail_sync_state (account_id,cursor,last_sync_at) VALUES ($1,$2,now())
		ON CONFLICT (account_id) DO UPDATE SET cursor=$2,last_sync_at=now()`, id, cursor)
	return err
}

// -- messages --

func (s *Store) InsertMessage(ctx context.Context, id, accountID, providerID, rfcID, threadID, folder, direction string, subject, fromA, toA string, internalDate int64) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO mail_messages (id,account_id,provider_id,rfc_message_id,thread_id,folder,direction,internal_date,subject,from_addr,to_addr)
		VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0),$9,$10,$11)
		ON CONFLICT (account_id,provider_id) DO NOTHING`, id, accountID, providerID, nullable(rfcID), nullable(threadID), folder, direction, internalDate, nullable(subject), nullable(fromA), nullable(toA))
	return err
}

// -- events --

func (s *Store) EnqueueEvent(ctx context.Context, id, accountID, event string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO mail_events (id,account_id,event,payload) VALUES ($1,$2,$3,$4)`, id, nullable(accountID), event, string(b))
	return err
}

func (s *Store) FetchDueEvents(ctx context.Context, limit int) ([]struct {
	ID        string
	AccountID string
	Event     string
	Payload   string
	Attempts  int
}, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, COALESCE(account_id,''), event, payload::text, attempts
		FROM mail_events WHERE delivered_at IS NULL AND next_attempt_at <= now() ORDER BY created_at LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct {
		ID        string
		AccountID string
		Event     string
		Payload   string
		Attempts  int
	}
	for rows.Next() {
		var e struct {
			ID        string
			AccountID string
			Event     string
			Payload   string
			Attempts  int
		}
		if err := rows.Scan(&e.ID, &e.AccountID, &e.Event, &e.Payload, &e.Attempts); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, nil
}

func (s *Store) MarkEventDelivered(ctx context.Context, id string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE mail_events SET delivered_at=now() WHERE id=$1`, id)
	return err
}

func (s *Store) MarkEventFailed(ctx context.Context, id, errMsg string, next time.Time) error {
	_, err := s.Pool.Exec(ctx, `UPDATE mail_events SET attempts=attempts+1, last_error=$2, next_attempt_at=$3 WHERE id=$1`, id, errMsg, next)
	return err
}

// -- settings --

func (s *Store) GetSetting(ctx context.Context, key string) (string, error) {
	row := s.Pool.QueryRow(ctx, `SELECT value::text FROM mail_settings WHERE key=$1`, key)
	var v *string
	if err := row.Scan(&v); err != nil {
		return "", err
	}
	if v == nil {
		return "", nil
	}
	return *v, nil
}
func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.Pool.Exec(ctx, `INSERT INTO mail_settings (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=$2::jsonb`, key, value)
	return err
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nonemptyJSON(s string) string {
	if s == "" || s == "null" {
		return "{}"
	}
	return s
}

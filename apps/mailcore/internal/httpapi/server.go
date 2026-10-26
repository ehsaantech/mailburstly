package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/mailrung/mailcore/internal/config"
	"github.com/mailrung/mailcore/internal/crypto"
	"github.com/mailrung/mailcore/internal/models"
	"github.com/mailrung/mailcore/internal/oauth"
	"github.com/mailrung/mailcore/internal/provider/gmail"
	"github.com/mailrung/mailcore/internal/provider/graph"
	smtpsender "github.com/mailrung/mailcore/internal/provider/smtpsmtp"
	"github.com/mailrung/mailcore/internal/store"
	"github.com/oklog/ulid/v2"
	"golang.org/x/oauth2"
)

type Server struct {
	Cfg   config.Config
	Store *store.Store
}

func (s *Server) Listen() error {
	r := mux.NewRouter()
	// GET+HEAD: healthcheckers that probe with wget --spider send HEAD.
	r.HandleFunc("/health", s.health).Methods("GET", "HEAD")

	// OAuth
	r.HandleFunc("/oauth/start", s.oauthStart).Methods("GET")
	r.HandleFunc("/oauth/callback", s.oauthCallback).Methods("GET")

	// Tracking / unsubscribe
	r.HandleFunc("/t/o/{token}.gif", s.trackOpen).Methods("GET")
	r.HandleFunc("/t/c/{id}", s.trackClick).Methods("GET")
	r.HandleFunc("/u/{token}", s.unsubscribe).Methods("GET", "POST")

	// Compat API
	api := r.PathPrefix("/v1").Subrouter()
	api.Use(s.bearerAuth)
	api.HandleFunc("/account", s.createAccount).Methods("POST")
	api.HandleFunc("/accounts", s.listAccounts).Methods("GET")
	api.HandleFunc("/account/{id}", s.getAccount).Methods("GET")
	api.HandleFunc("/account/{id}", s.deleteAccount).Methods("DELETE")
	api.HandleFunc("/account/{id}/reconnect", s.reconnectAccount).Methods("PUT")
	api.HandleFunc("/account/{id}/submit", s.submitMessage).Methods("POST")
	api.HandleFunc("/authentication/form", s.authForm).Methods("POST")
	api.HandleFunc("/verifyAccount", s.verifyAccount).Methods("POST")
	api.HandleFunc("/settings", s.postSettings).Methods("POST")
	api.HandleFunc("/oauth2", s.oauth2App).Methods("POST")

	srv := &http.Server{Addr: fmt.Sprintf(":%d", s.Cfg.Port), Handler: r, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second}
	fmt.Printf("mailcore listening on :%d\n", s.Cfg.Port)
	return srv.ListenAndServe()
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	accs, _ := s.Store.ListAccounts(r.Context())
	writeJSON(w, 200, map[string]any{"ok": true, "accounts": len(accs)})
}

func (s *Server) bearerAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.Cfg.APIToken != "" {
			h := r.Header.Get("Authorization")
			if !strings.HasPrefix(h, "Bearer ") || strings.TrimPrefix(h, "Bearer ") != s.Cfg.APIToken {
				writeJSON(w, 401, map[string]any{"statusCode": 401, "error": "Unauthorized", "message": "invalid or missing token"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]any{"statusCode": code, "error": http.StatusText(code), "message": msg})
}
func readJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}

// ----- OAuth -----

func (s *Server) oauthStart(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	provider := q.Get("provider")
	if provider == "" {
		provider = "google"
	}
	accountID := q.Get("account")
	if accountID == "" {
		accountID = ulid.Make().String()
	}
	st := oauth.NewState()
	verifier := oauth.NewVerifier()
	redirectTo := s.Cfg.PublicURL + "/mailboxes/callback"

	var ep oauth2.Endpoint
	var cfg oauth.ProviderConfig
	switch provider {
	case "google":
		if s.Cfg.GoogleClientID == "" {
			writeErr(w, 503, "GOOGLE_CLIENT_ID not configured")
			return
		}
		cfg = oauth.ProviderConfig{ClientID: s.Cfg.GoogleClientID, ClientSecret: s.Cfg.GoogleClientSecret,
			RedirectURL: s.Cfg.PublicURL + "/oauth/callback", Scopes: []string{"openid", "email", "profile", "https://www.googleapis.com/auth/gmail.modify"}}
		ep = oauth.GoogleEndpoint()
	case "microsoft":
		if s.Cfg.MicrosoftClientID == "" {
			writeErr(w, 503, "MICROSOFT_CLIENT_ID not configured")
			return
		}
		cfg = oauth.ProviderConfig{ClientID: s.Cfg.MicrosoftClientID, ClientSecret: s.Cfg.MicrosoftClientSecret,
			Tenant: s.Cfg.MicrosoftTenant, RedirectURL: s.Cfg.PublicURL + "/oauth/callback",
			Scopes: []string{"openid", "profile", "email", "offline_access", "User.Read", "https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/Mail.Send"}}
		ep = oauth.MicrosoftEndpoint(cfg.Tenant)
	default:
		writeErr(w, 400, "unknown provider")
		return
	}
	extra := url.Values{}
	if provider == "google" {
		extra.Set("access_type", "offline")
		extra.Set("prompt", "consent")
	}
	authURL := oauth.AuthURL(ep, cfg, st, verifier, extra)
	if err := s.Store.SaveOAuthState(r.Context(), map[string]any{
		"state": st, "account_id": accountID, "provider": provider, "code_verifier": verifier, "redirect_to": redirectTo,
	}); err != nil {
		writeErr(w, 500, "save state: "+err.Error())
		return
	}
	http.Redirect(w, r, authURL, http.StatusFound)
}

func (s *Server) oauthCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	code := q.Get("code")
	state := q.Get("state")
	if code == "" || state == "" {
		writeErr(w, 400, "missing code/state")
		return
	}
	st, err := s.Store.GetOAuthState(r.Context(), state)
	if err != nil {
		writeErr(w, 400, "invalid state: "+err.Error())
		return
	}
	provider := st["provider"].(string)
	accountID := st["account_id"].(string)
	verifier := st["code_verifier"].(string)

	var cfg oauth.ProviderConfig
	var ep oauth2.Endpoint
	switch provider {
	case "google":
		cfg = oauth.ProviderConfig{ClientID: s.Cfg.GoogleClientID, ClientSecret: s.Cfg.GoogleClientSecret,
			RedirectURL: s.Cfg.PublicURL + "/oauth/callback", Scopes: []string{"openid", "email", "profile", "https://www.googleapis.com/auth/gmail.modify"}}
		ep = oauth.GoogleEndpoint()
	case "microsoft":
		cfg = oauth.ProviderConfig{ClientID: s.Cfg.MicrosoftClientID, ClientSecret: s.Cfg.MicrosoftClientSecret,
			Tenant: s.Cfg.MicrosoftTenant, RedirectURL: s.Cfg.PublicURL + "/oauth/callback",
			Scopes: []string{"openid", "profile", "email", "offline_access", "User.Read", "https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/Mail.Send"}}
		ep = oauth.MicrosoftEndpoint(cfg.Tenant)
	default:
		writeErr(w, 400, "unknown provider")
		return
	}
	tok, err := oauth.Exchange(ep, cfg, code, verifier)
	if err != nil {
		writeErr(w, 502, "exchange failed: "+err.Error())
		return
	}
	var email string
	switch provider {
	case "google":
		email, err = gmail.Provider{}.UserInfo(tok.AccessToken)
	case "microsoft":
		email, err = graph.Provider{}.UserInfo(tok.AccessToken)
	}
	if err != nil || email == "" {
		writeErr(w, 502, "userinfo failed: "+fmtErr(err))
		return
	}
	accType := "gmail"
	if provider == "microsoft" {
		accType = "outlook"
	}
	accessEnc, _ := crypto.Seal(s.Cfg.EncryptionKey, tok.AccessToken)
	refresh := tok.RefreshToken
	if refresh == "" {
		if ex, _ := s.Store.GetAccount(r.Context(), accountID); ex != nil {
			opened, _ := crypto.Open(s.Cfg.EncryptionKey, ex.RefreshTokEnc)
			refresh = opened
		}
	}
	refreshEnc, _ := crypto.Seal(s.Cfg.EncryptionKey, refresh)
	row := store.AccountRow{
		ID: accountID, Email: email, DisplayName: email, Provider: provider, Status: "connected",
		Scopes: cfg.Scopes, AccessTokEnc: accessEnc, RefreshTokEnc: refreshEnc, KeyVersion: 1,
	}
	et := tok.Expiry
	row.AccessExpiresAt = &et
	if err := s.Store.UpsertAccount(r.Context(), row); err != nil {
		writeErr(w, 500, "store account: "+err.Error())
		return
	}
	_ = accType
	http.Redirect(w, r, st["redirect_to"].(string)+"?account="+accountID+"&state=new", http.StatusFound)
}

func fmtErr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// ----- compat endpoints -----

func (s *Server) createAccount(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	readJSON(r, &body)
	account, _ := body["account"].(string)
	if account == "" {
		account = ulid.Make().String()
	}
	email, _ := body["email"].(string)
	name, _ := body["name"].(string)
	if name == "" {
		name = email
	}
	// collect smtp settings
	settings := map[string]any{}
	if sm, ok := body["smtp"].(map[string]any); ok {
		settings["smtp"] = sm
		for k, v := range sm {
			settings["smtp_"+k] = v
		}
	}
	if im, ok := body["imap"].(map[string]any); ok {
		settings["imap"] = im
	}
	setJSON, _ := json.Marshal(settings)
	provider := "imap"
	if email != "" && (settings["smtp_host"] != nil || settings["smtp"] != nil) {
		provider = "imap" // generic, handled via smtp settings
	}
	row := store.AccountRow{
		ID: account, Email: email, DisplayName: name, Provider: provider,
		Status: "connected", Settings: string(setJSON), Scopes: []string{},
		RefreshTokEnc: "none", KeyVersion: 1,
	}
	// oauth accounts are created via callback; manual smtp accounts still need a refresh token placeholder
	if err := s.Store.UpsertAccount(r.Context(), row); err != nil {
		writeErr(w, 500, "store: "+err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"account": account, "state": "connected"})
}

func (s *Server) listAccounts(w http.ResponseWriter, r *http.Request) {
	rows, _ := s.Store.ListAccounts(r.Context())
	var out []map[string]any
	for _, r := range rows {
		out = append(out, map[string]any{"account": r.ID, "email": r.Email, "type": r.Provider, "state": r.Status})
	}
	writeJSON(w, 200, map[string]any{"accounts": out})
}

func (s *Server) getAccount(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	row, err := s.Store.GetAccount(r.Context(), id)
	if err != nil {
		writeErr(w, 404, "account not found")
		return
	}
	accType := "gmail"
	if row.Provider == "microsoft" {
		accType = "outlook"
	}
	state := row.Status
	if state == "" {
		state = "connected"
	}
	writeJSON(w, 200, map[string]any{
		"account": row.ID, "email": row.Email, "name": row.DisplayName,
		"type": accType, "state": state, "createdAt": time.Now().Format(time.RFC3339),
	})
}

func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	s.Store.DeleteAccount(r.Context(), id)
	w.WriteHeader(204)
}

func (s *Server) reconnectAccount(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	row, err := s.Store.GetAccount(r.Context(), id)
	if err != nil {
		writeErr(w, 404, "account not found")
		return
	}
	provider := "google"
	if row.Provider == "microsoft" {
		provider = "microsoft"
	}
	url := s.Cfg.PublicURL + "/oauth/start?provider=" + provider + "&account=" + id
	writeJSON(w, 200, map[string]any{"url": url})
}

func (s *Server) verifyAccount(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	readJSON(r, &body)
	smtpOK := false
	if sm, ok := body["smtp"].(map[string]any); ok {
		ss := smtpsender.Settings{}
		if h, ok := sm["host"].(string); ok {
			ss.Host = h
		}
		if u, ok := sm["user"].(string); ok {
			ss.User = u
		}
		if p, ok := sm["pass"].(string); ok {
			ss.Pass = p
		}
		if p, ok := sm["port"].(float64); ok {
			ss.Port = int(p)
		}
		if sec, ok := sm["secure"].(string); ok {
			ss.Secure = sec
		}
		smtpOK = smtpsender.Verify(ss)
	}
	writeJSON(w, 200, map[string]any{"imap": false, "smtp": smtpOK})
}

func (s *Server) authForm(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	readJSON(r, &body)
	account, _ := body["account"].(string)
	if account == "" {
		account = ulid.Make().String()
	}
	provider := "google"
	if p, ok := body["provider"].(string); ok && p != "" {
		provider = p
	}
	// legacy fallback: if type/app id was passed, still default google unless microsoft
	if t, ok := body["type"].(string); ok && strings.Contains(strings.ToLower(t), "microsoft") || strings.Contains(strings.ToLower(t), "outlook") {
		provider = "microsoft"
	}
	url := s.Cfg.PublicURL + "/oauth/start?provider=" + provider + "&account=" + account
	writeJSON(w, 200, map[string]any{"url": url})
}

func (s *Server) postSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	readJSON(r, &body)
	b, _ := json.Marshal(body)
	s.Store.SetSetting(r.Context(), "settings", string(b))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) oauth2App(w http.ResponseWriter, r *http.Request) {
	// retired: configure via env. Return a synthetic id.
	writeJSON(w, 200, map[string]any{"app": "mailcore", "message": "configure GOOGLE_CLIENT_ID / MICROSOFT_CLIENT_ID in mailcore env"})
}

// ----- submit -----

func (s *Server) submitMessage(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	row, err := s.Store.GetAccount(r.Context(), id)
	if err != nil {
		writeErr(w, 404, "account not found")
		return
	}
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	to := ""
	if arr, ok := body["to"].([]any); ok && len(arr) > 0 {
		if o, ok := arr[0].(map[string]any); ok {
			to, _ = o["address"].(string)
		}
	}
	subject, _ := body["subject"].(string)
	text, _ := body["text"].(string)
	html, _ := body["html"].(string)
	trackOpens, _ := body["trackOpens"].(bool)
	trackClicks, _ := body["trackClicks"].(bool)

	// generate Message-ID
	msgID := "<" + ulid.Make().String() + "@mailcore>"
	mime := buildMime(row.Email, row.DisplayName, to, subject, text, html, msgID, body, trackOpens, trackClicks, s.Cfg.PublicURL)

	// access token (only for OAuth providers)
	access := ""
	if row.Provider == "google" || row.Provider == "microsoft" {
		a, err := crypto.Open(s.Cfg.EncryptionKey, row.AccessTokEnc)
		if err != nil || a == "" {
			writeErr(w, 401, "no access token; reconnect")
			return
		}
		access = a
		exp := int64(0)
		if row.AccessExpiresAt != nil {
			exp = row.AccessExpiresAt.Unix()
		}
		if exp != 0 && time.Now().Unix() > exp {
			writeErr(w, 401, "access token expired; reconnect")
			return
		}
	}
	_ = access

	threadHint := ""
	if ref, ok := body["reference"].(map[string]any); ok {
		if m, _ := ref["message"].(string); m != "" {
			// resolve our stored message id -> rfc id if present (best effort)
			threadHint = m
		}
	}
	_ = threadHint

	var finalID string
	switch row.Provider {
	case "google":
		finalID, err = gmail.Provider{}.Send(&models.Account{ID: row.ID, Email: row.Email}, access, mime, "")
	case "microsoft":
		finalID, err = graph.Provider{}.Send(&models.Account{ID: row.ID, Email: row.Email}, access, mime, "")
	default:
		// plain SMTP (manual account)
		var ss struct {
			SMTP struct {
				Host   string `json:"host"`
				Port   int    `json:"port"`
				User   string `json:"user"`
				Pass   string `json:"pass"`
				Secure string `json:"secure"`
			} `json:"smtp"`
		}
		json.Unmarshal([]byte(row.Settings), &ss)
		finalID, err = smtpsender.Send(smtpsender.Settings{
			Host: ss.SMTP.Host, Port: ss.SMTP.Port, User: ss.SMTP.User,
			Pass: ss.SMTP.Pass, Secure: ss.SMTP.Secure, FromEmail: row.Email,
		}, to, subject, text, html)
	}
	if err != nil {
		writeErr(w, 502, err.Error())
		return
	}
	if finalID == "" {
		finalID = msgID
	}
	// store message mapping
	s.Store.InsertMessage(r.Context(), ulid.Make().String(), row.ID, "provider", finalID, "", "SENT", "outbound", subject, row.Email, to, time.Now().UnixMilli())
	writeJSON(w, 200, map[string]any{"messageId": finalID})
}

func buildMime(fromEmail, fromName, to, subject, text, html, msgID string, body map[string]any, trackOpens, trackClicks bool, baseURL string) string {
	var b strings.Builder
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString(fmt.Sprintf("From: %s <%s>\r\n", fromName, fromEmail))
	b.WriteString(fmt.Sprintf("To: %s\r\n", to))
	b.WriteString(fmt.Sprintf("Subject: %s\r\n", subject))
	b.WriteString(fmt.Sprintf("Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z)))
	b.WriteString(fmt.Sprintf("Message-ID: %s\r\n", msgID))
	if v, ok := body["headers"].(map[string]any); ok {
		for k, val := range v {
			b.WriteString(fmt.Sprintf("%s: %v\r\n", k, val))
		}
	}
	b.WriteString("Content-Type: multipart/alternative; boundary=\"bnd\"\r\n\r\n")
	b.WriteString("--bnd\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n")
	b.WriteString(text)
	b.WriteString("\r\n--bnd\r\nContent-Type: text/html; charset=utf-8\r\n\r\n")
	finalHTML := html
	if trackOpens {
		finalHTML += fmt.Sprintf(`<img src="%s/t/o/%s.gif" width="1" height="1" alt="">`, baseURL, msgID)
	}
	b.WriteString(finalHTML)
	b.WriteString("\r\n--bnd--\r\n")
	return b.String()
}

// ----- tracking / unsubscribe -----

func (s *Server) trackOpen(w http.ResponseWriter, r *http.Request) {
	token := mux.Vars(r)["token"]
	// enqueue event; messageId stored in token (URL-decoded). Accept opaque token == message id here.
	s.Store.EnqueueEvent(r.Context(), ulid.Make().String(), "", "trackOpen", map[string]any{
		"messageId": token, "originalMessageId": token, "userAgent": r.UserAgent(), "date": time.Now(),
	})
	// 1x1 gif
	gif := []byte{0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b}
	w.Header().Set("Content-Type", "image/gif")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(gif)
}

func (s *Server) trackClick(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	s.Store.EnqueueEvent(r.Context(), ulid.Make().String(), "", "trackClick", map[string]any{
		"messageId": id, "originalMessageId": id, "url": "", "userAgent": r.UserAgent(), "date": time.Now(),
	})
	w.Header().Set("Location", "/")
	w.WriteHeader(302)
}

func (s *Server) unsubscribe(w http.ResponseWriter, r *http.Request) {
	token := mux.Vars(r)["token"]
	_ = token
	if r.Method == "GET" {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<p>Unsubscribe confirmed.</p>"))
		return
	}
	s.Store.EnqueueEvent(r.Context(), ulid.Make().String(), "", "listUnsubscribe", map[string]any{"recipient": ""})
	w.WriteHeader(200)
}

// ----- main glue for gateway URL conversion (unused placeholders) -----
func base64Raw(s string) string { return base64.RawURLEncoding.EncodeToString([]byte(s)) }
func init()                     { _ = os.Args }

var _ = http.MethodPost
var _ = oauth.ProviderConfig{}
var _ = models.InboundMessage{}
var _ = gmail.Provider{}
var _ = graph.Provider{}
var _ = store.Store{}

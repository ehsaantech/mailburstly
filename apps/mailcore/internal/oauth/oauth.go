package oauth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

type ProviderConfig struct {
	ClientID     string
	ClientSecret string
	Tenant       string
	RedirectURL  string
	Scopes       []string
}

func GoogleEndpoint() oauth2.Endpoint { return google.Endpoint }

func MicrosoftEndpoint(tenant string) oauth2.Endpoint {
	if tenant == "" {
		tenant = "common"
	}
	return oauth2.Endpoint{
		AuthURL:  "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/authorize",
		TokenURL: "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/token",
	}
}

func AuthURL(ep oauth2.Endpoint, cfg ProviderConfig, state, verifier string, extra url.Values) string {
	v := url.Values{}
	v.Set("client_id", cfg.ClientID)
	v.Set("redirect_uri", cfg.RedirectURL)
	v.Set("response_type", "code")
	v.Set("scope", strings.Join(cfg.Scopes, " "))
	v.Set("state", state)
	// PKCE
	h := sha256.Sum256([]byte(verifier))
	v.Set("code_challenge", base64.RawURLEncoding.EncodeToString(h[:]))
	v.Set("code_challenge_method", "S256")
	for k, vv := range extra {
		for _, x := range vv {
			v.Set(k, x)
		}
	}
	return ep.AuthURL + "?" + v.Encode()
}

func Exchange(ep oauth2.Endpoint, cfg ProviderConfig, code, verifier string) (*oauth2.Token, error) {
	form := url.Values{}
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", cfg.RedirectURL)
	form.Set("grant_type", "authorization_code")
	form.Set("code_verifier", verifier)
	req, _ := http.NewRequest("POST", ep.TokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("token exchange %d: %s", resp.StatusCode, string(b))
	}
	var t oauth2.Token
	var raw map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}
	if v, ok := raw["access_token"].(string); ok {
		t.AccessToken = v
	}
	if v, ok := raw["refresh_token"].(string); ok {
		t.RefreshToken = v
	}
	if v, ok := raw["token_type"].(string); ok {
		t.TokenType = v
	}
	if v, ok := raw["expires_in"].(float64); ok {
		t.Expiry = time.Now().Add(time.Duration(v) * time.Second)
	}
	return &t, nil
}

func NewVerifier() string {
	b := make([]byte, 32)
	io.ReadFull(rand.Reader, b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func NewState() string {
	b := make([]byte, 16)
	io.ReadFull(rand.Reader, b)
	return base64.RawURLEncoding.EncodeToString(b)
}

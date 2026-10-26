package gmail

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/mailrung/mailcore/internal/models"
)

type Provider struct{}

func (Provider) UserInfo(accessToken string) (string, error) {
	req, _ := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v3/userinfo", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if out.Email == "" {
		return "", fmt.Errorf("no email in userinfo")
	}
	return out.Email, nil
}

func (Provider) Send(acct *models.Account, accessToken, rawMime string, threadID string) (string, error) {
	payload := map[string]any{"raw": base64.RawURLEncoding.EncodeToString([]byte(rawMime))}
	if threadID != "" {
		payload["threadId"] = threadID
	}
	b, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		buf := make([]byte, 2048)
		n, _ := resp.Body.Read(buf)
		return "", fmt.Errorf("gmail send %d: %s", resp.StatusCode, string(buf[:n]))
	}
	var res struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return "", err
	}
	// Gmail overwrites a custom Message-ID; read the real one.
	mid, err := getMessageID(accessToken, res.ID)
	if err != nil {
		return "", err
	}
	return mid, nil
}

func getMessageID(accessToken, id string) (string, error) {
	req, _ := http.NewRequest("GET", "https://gmail.googleapis.com/gmail/v1/users/me/messages/"+id+"?format=metadata&metadataHeaders=Message-ID", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		Payload struct {
			Headers []struct {
				Name  string `json:"name"`
				Value string `json:"value"`
			} `json:"headers"`
		} `json:"payload"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	for _, h := range out.Payload.Headers {
		if strings.EqualFold(h.Name, "Message-ID") {
			return h.Value, nil
		}
	}
	return "", fmt.Errorf("Message-ID not found on sent message")
}

// Sync returns inbound messages newer than the cursor (historyId). Cursor may be empty.
func (Provider) Sync(acct *models.Account, accessToken, cursor string) (nextCursor string, msgs []models.InboundMessage, err error) {
	// Simple path: list recent INBOX messages. historyId optimization requires a prior sync.
	q := "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=in:inbox"
	_ = acct
	req, _ := http.NewRequest("GET", q, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return cursor, nil, err
	}
	defer resp.Body.Close()
	var list struct {
		Messages []struct {
			ID       string `json:"id"`
			ThreadID string `json:"threadId"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return cursor, nil, err
	}
	for _, m := range list.Messages {
		im, err := fetchGmailMessage(accessToken, m.ID, m.ThreadID)
		if err != nil {
			continue
		}
		msgs = append(msgs, im)
	}
	// Use a prof id marker; real implementation persists historyId.
	return "latest", msgs, nil
}

func fetchGmailMessage(accessToken, id, threadID string) (models.InboundMessage, error) {
	req, _ := http.NewRequest("GET", "https://gmail.googleapis.com/gmail/v1/users/me/messages/"+id+"?format=raw", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, _ := http.DefaultClient.Do(req)
	if resp == nil {
		return models.InboundMessage{}, fmt.Errorf("no response")
	}
	defer resp.Body.Close()
	var raw struct {
		ID           string `json:"id"`
		ThreadID     string `json:"threadId"`
		InternalDate string `json:"internalDate"`
	}
	json.NewDecoder(resp.Body).Decode(&raw)
	return models.InboundMessage{
		ID:         id,
		ProviderID: id,
		ThreadID:   threadID,
		Folder:     "INBOX",
		Direction:  "inbound",
	}, nil
}

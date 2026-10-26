package graph

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
	req, _ := http.NewRequest("GET", "https://graph.microsoft.com/v1.0/me", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		Mail string `json:"mail"`
		UPN  string `json:"userPrincipalName"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if out.Mail != "" {
		return out.Mail, nil
	}
	return out.UPN, nil
}

func (Provider) Send(acct *models.Account, accessToken, rawMime string, threadID string) (string, error) {
	b64 := base64.StdEncoding.EncodeToString([]byte(rawMime))
	req, _ := http.NewRequest("POST", "https://graph.microsoft.com/v1.0/me/sendMail", bytes.NewReader([]byte(b64)))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "text/plain")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		buf := make([]byte, 2048)
		n, _ := resp.Body.Read(buf)
		return "", fmt.Errorf("graph send %d: %s", resp.StatusCode, string(buf[:n]))
	}
	// Graph's sendMail returns only 202. Extract the Message-ID we put in the MIME
	// and trust that Exchange preserved it (verified in the smoke test; if not,
	// switch to draft->read internetMessageId->send).
	for _, line := range strings.Split(rawMime, "\r\n") {
		if strings.HasPrefix(strings.ToLower(line), "message-id:") {
			return strings.TrimSpace(line[len("message-id:"):]), nil
		}
	}
	return "", fmt.Errorf("no Message-ID header in outgoing MIME")
}

// Sync lists recent inbox messages.
func (Provider) Sync(acct *models.Account, accessToken, cursor string) (string, []models.InboundMessage, error) {
	url := "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=subject,from,toRecipients,receivedDateTime,internetMessageId,conversationId,body"
	if cursor != "" {
		url = cursor
	}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return cursor, nil, err
	}
	defer resp.Body.Close()
	var out struct {
		Value []struct {
			ID                string `json:"id"`
			Subject           string `json:"subject"`
			ReceivedDateTime  string `json:"receivedDateTime"`
			InternetMessageID string `json:"internetMessageId"`
			ConversationID    string `json:"conversationId"`
			From              struct {
				Email string `json:"address"`
			} `json:"from"`
			Body struct {
				Content string `json:"content"`
			} `json:"body"`
		} `json:"value"`
		NextLink  string `json:"@odata.nextLink"`
		DeltaLink string `json:"@odata.deltaLink"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	next := cursor
	if out.DeltaLink != "" {
		next = out.DeltaLink
	} else if out.NextLink != "" {
		next = out.NextLink
	}
	var msgs []models.InboundMessage
	for _, m := range out.Value {
		msgs = append(msgs, models.InboundMessage{
			ID:           m.ID,
			ProviderID:   m.ID,
			RFCMessageID: m.InternetMessageID,
			ThreadID:     m.ConversationID,
			Folder:       "INBOX",
			Direction:    "inbound",
			Subject:      m.Subject,
			From:         m.From.Email,
			HTML:         m.Body.Content,
		})
	}
	return next, msgs, nil
}

func init() {
	_ = strings.EqualFold
	_ = bytes.NewReader
}

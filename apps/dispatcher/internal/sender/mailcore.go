package sender

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/mailrung/dispatcher/internal/render"
	"github.com/mailrung/dispatcher/internal/types"
)

// MailcoreClient submits messages to mailcore.
type MailcoreClient struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

// New creates a client.
func New(baseURL, token string) *MailcoreClient {
	return &MailcoreClient{
		BaseURL: baseURL,
		Token:   token,
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}
}

// BuildRenderData assembles the variable set for a job. Custom variables are
// merged in, then the well-known fields overwrite them, so a lead's own
// "company" column always wins over a stray custom variable of the same name.
func BuildRenderData(job *types.SendJob) render.Data {
	data := render.Data{}

	for k, v := range job.CustomVariables {
		data[k] = v
	}

	if job.LeadFirstName != nil {
		data["first_name"] = *job.LeadFirstName
	}
	if job.LeadLastName != nil {
		data["last_name"] = *job.LeadLastName
	}
	if job.LeadTitle != nil {
		data["title"] = *job.LeadTitle
	}
	if job.LeadCompany != nil {
		data["company"] = *job.LeadCompany
	}
	data["email"] = job.LeadEmail
	data["campaign_name"] = job.CampaignName
	data["current_date"] = time.Now().Format("2 January 2006")
	data["sender_name"] = senderName(job.MailboxEmail)

	return data
}

// senderName derives a display name from the sending address.
func senderName(mailbox string) string {
	at := strings.Index(mailbox, "@")
	if at <= 0 {
		return mailbox
	}
	local := mailbox[:at]
	parts := strings.FieldsFunc(local, func(r rune) bool {
		return r == '.' || r == '_' || r == '-'
	})
	for i, p := range parts {
		if p == "" {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + p[1:]
	}
	return strings.Join(parts, " ")
}

// SubmitMessage renders and sends a message via mailcore.
func (c *MailcoreClient) SubmitMessage(job *types.SendJob) (*types.SendResult, error) {
	data := BuildRenderData(job)
	opts := render.Options{EnableSpintax: true}

	// The A/Z variant, when assigned, wins over the base step.
	subjectTmpl := job.StepSubject
	bodyTmpl := job.StepBodyHTML
	if job.VariantSubject != nil && *job.VariantSubject != "" {
		subjectTmpl = job.VariantSubject
	}
	if job.VariantBody != nil && *job.VariantBody != "" {
		bodyTmpl = *job.VariantBody
	}

	subject := ""
	if subjectTmpl != nil {
		subject = render.Render(*subjectTmpl, data, opts)
	}
	body := render.Render(bodyTmpl, data, opts)

	// Step 1 is always plain text: no HTML, no tracking pixel, no rewritten
	// links. A campaign may also ask for plain text for every step.
	textOnly := job.TextOnly || job.StepPosition == 1

	// A plain-text alternative is derived from the body so clients that
	// cannot render HTML still get something readable.
	var plain string
	if job.StepBodyText != nil {
		plain = render.Render(*job.StepBodyText, data, opts)
	} else if textOnly {
		plain = htmlToText(body)
	} else {
		plain = render.Render(body, data, opts)
	}

	// mailcore expects recipients as an array of address objects, and the
	// sending account is identified by its id in the URL path.
	htmlBody := body
	if textOnly {
		htmlBody = ""
	}
	trackOpens := job.OpenTracking
	trackClicks := job.LinkTracking
	if textOnly {
		trackOpens = false
		trackClicks = false
	}

	payload := map[string]any{
		"to": []map[string]any{
			{"address": job.LeadEmail},
		},
		"subject": subject,
		"text":    plain,
		// Tracking is a per-campaign switch. mailcore inserts the
		// tracking pixel and rewrites the links itself when these are on.
		"trackOpens":  trackOpens,
		"trackClicks": trackClicks,
		// The List-Unsubscribe header, when the campaign asks for one. The
		// link identifies the recipient, so mailcore mints it per message.
		"unsubscribeHeader": job.UnsubscribeHeader,
	}
	if htmlBody != "" {
		payload["html"] = htmlBody
	}

	data2, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}

	account := job.MailcoreAccountID
	if account == "" {
		return nil, fmt.Errorf("mailbox %s has no mailcore_account_id", job.MailboxID)
	}

	req, err := http.NewRequest(
		"POST",
		c.BaseURL+"/v1/account/"+url.PathEscape(account)+"/submit",
		bytes.NewReader(data2),
	)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Token)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("submit: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		var detail []byte
		buf := make([]byte, 2048)
		n, _ := resp.Body.Read(buf)
		detail = buf[:n]
		return nil, fmt.Errorf("mailcore returned %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}

	var result types.SendResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		// Not all responses have a body; that's fine.
		return &types.SendResult{}, nil
	}
	return &result, nil
}

// htmlToText flattens an HTML body into readable plain text for the
// text-only path. It is deliberately dependency-free.
func htmlToText(htmlIn string) string {
	s := htmlIn
	reBr := regexp.MustCompile(`(?i)<br\s*/?>`)
	s = reBr.ReplaceAllString(s, "\n")
	reBlock := regexp.MustCompile(`(?i)</(p|div|li|h[1-6]|tr)>`)
	s = reBlock.ReplaceAllString(s, "\n")
	reBullet := regexp.MustCompile(`(?i)<li[^>]*>`)
	s = reBullet.ReplaceAllString(s, "  • ")
	reTag := regexp.MustCompile(`</?[^>]+>`)
	s = reTag.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	reBlank := regexp.MustCompile(`\n{3,}`)
	s = reBlank.ReplaceAllString(s, "\n\n")
	return strings.TrimSpace(s)
}

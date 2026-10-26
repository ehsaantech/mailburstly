package models

type Account struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	DisplayName   string `json:"name"`
	Type          string `json:"type"` // gmail | outlook
	Provider      string // google | microsoft
	Status        string `json:"state"` // connected | syncing | authentication_error | ...
	Scopes        []string
	AccessToken   string
	RefreshToken  string
	AccessExpires int64
	LastError     string
}

type OAuthState struct {
	State        string
	AccountID    string
	Provider     string
	CodeVerifier string
	RedirectTo   string
}

type InboundMessage struct {
	ID           string
	ProviderID   string
	RFCMessageID string
	ThreadID     string
	Folder       string
	Direction    string // inbound | outbound
	InternalDate int64
	Subject      string
	From         string
	To           string
	IsAutoReply  bool
	IsBounce     bool
	IsComplaint  bool
	Plain        string
	HTML         string
	Headers      map[string]string
	InReplyTo    string
}

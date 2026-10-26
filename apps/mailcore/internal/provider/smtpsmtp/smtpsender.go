package smtpsender

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"time"

	mail "github.com/wneessen/go-mail"
)

type Settings struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	User      string `json:"user"`
	Pass      string `json:"pass"`
	Secure    string `json:"secure"` // "ssl" | "starttls" | ""
	FromEmail string `json:"from_email"`
}

func Send(s Settings, to, subject, text, html string) (string, error) {
	if s.Host == "" || s.Port == 0 {
		return "", fmt.Errorf("smtp host/port missing")
	}
	if s.FromEmail == "" {
		s.FromEmail = s.User
	}
	msg := mail.NewMsg()
	if err := msg.From(s.FromEmail); err != nil {
		return "", err
	}
	if err := msg.AddTo(to); err != nil {
		return "", err
	}
	msg.Subject(subject)
	msg.SetBodyString(mail.TypeTextPlain, text)
	if html != "" {
		msg.AddAlternativeString(mail.TypeTextHTML, html)
	}
	msgID := "<" + hex.EncodeToString(md5.New().Sum([]byte(time.Now().String()+to))) + "@mailcore>"
	msg.SetMessageIDWithValue(msgID)
	msg.SetDate()

	opts := []mail.Option{mail.WithPort(s.Port), mail.WithUsername(s.User), mail.WithPassword(s.Pass)}
	switch s.Secure {
	case "ssl":
		opts = append(opts, mail.WithSSL())
	case "starttls":
		opts = append(opts, mail.WithTLSPolicy(mail.TLSMandatory))
	default:
		opts = append(opts, mail.WithTLSPolicy(mail.NoTLS))
	}
	if s.User != "" {
		opts = append(opts, mail.WithSMTPAuth(mail.SMTPAuthPlain))
	}

	client, err := mail.NewClient(s.Host, opts...)
	if err != nil {
		return "", err
	}
	defer client.Close()
	if err := client.DialWithContext(nil); err != nil {
		return "", err
	}
	if err := client.Send(msg); err != nil {
		return "", err
	}
	return msgID, nil
}

func Verify(s Settings) bool {
	opts := []mail.Option{mail.WithPort(s.Port), mail.WithTLSPolicy(mail.NoTLS)}
	client, err := mail.NewClient(s.Host, opts...)
	if err != nil {
		return false
	}
	defer client.Close()
	return client.DialWithContext(nil) == nil
}

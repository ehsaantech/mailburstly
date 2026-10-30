package sender

import (
	"testing"

	"github.com/mailrung/dispatcher/internal/types"
)

func TestBuildRenderDataPrefersLeadColumnsOverCustomVariables(t *testing.T) {
	job := &types.SendJob{
		LeadEmail:       "zahid@example.com",
		LeadFirstName:   ptr("Zahid"),
		LeadLastName:    ptr("Khan"),
		LeadCompany:     ptr("Northwind"),
		LeadTitle:       ptr("Head of Growth"),
		CustomVariables: map[string]string{"company": "WRONG", "industry": "SaaS"},
		CampaignName:    "Q4 Founders",
		MailboxEmail:    "sarah.w@getacme.io",
	}

	data := BuildRenderData(job)

	if data["company"] != "Northwind" {
		t.Fatalf("company should come from the lead column, got %q", data["company"])
	}
	if data["industry"] != "SaaS" {
		t.Fatalf("custom variable should survive, got %q", data["industry"])
	}
	if data["first_name"] != "Zahid" {
		t.Fatalf("first_name = %q", data["first_name"])
	}
	if data["sender_name"] != "Sarah W" {
		t.Fatalf("sender_name = %q", data["sender_name"])
	}
	if data["campaign_name"] != "Q4 Founders" {
		t.Fatalf("campaign_name = %q", data["campaign_name"])
	}
	if data["current_date"] == "" {
		t.Fatal("current_date should be set")
	}
}

func TestSenderNameDerivation(t *testing.T) {
	cases := map[string]string{
		"sarah@getacme.io":         "Sarah",
		"sarah.w@getacme.io":       "Sarah W",
		"james_port@getacme.io":    "James Port",
		"not-an-email":             "not-an-email",
		"a.b.c@getacme.io":         "A B C",
	}

	for in, want := range cases {
		if got := senderName(in); got != want {
			t.Fatalf("senderName(%q) = %q want %q", in, got, want)
		}
	}
}

func ptr(s string) *string { return &s }

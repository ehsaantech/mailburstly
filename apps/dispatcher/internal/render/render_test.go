package render

import "testing"

func deterministic(seed int) func(int) int {
	return func(n int) int {
		if n <= 0 {
			return 0
		}
		return seed % n
	}
}

func TestRenderMergeVariables(t *testing.T) {
	data := Data{
		"first_name": "Zahid",
		"company":    "Northwind Labs",
	}

	got := Render("Hi {{first_name}}, quick question about {{company}}.", data, Options{})
	want := "Hi Zahid, quick question about Northwind Labs."
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestRenderMissingVariableUsesFallback(t *testing.T) {
	// No first_name in the data. A raw token must never survive.
	got := Render("Hi {{first_name}}, this is {{company}}.", Data{}, Options{})
	want := "Hi there, this is your team."
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestRenderUnknownVariableIsRemoved(t *testing.T) {
	got := Render("value={{totally_unknown}} end", Data{}, Options{})
	if got != "value= end" {
		t.Fatalf("got %q", got)
	}
}

func TestRenderDefaultFilter(t *testing.T) {
	got := Render(`{{company | default: "Acme Inc"}}`, Data{}, Options{})
	if got != "Acme Inc" {
		t.Fatalf("got %q", got)
	}
}

func TestRenderDefaultFilterKeepsExistingValue(t *testing.T) {
	got := Render(`{{company | default: "Acme Inc"}}`, Data{"company": "Real Co"}, Options{})
	if got != "Real Co" {
		t.Fatalf("got %q", got)
	}
}

func TestRenderIfElse(t *testing.T) {
	data := Data{"company": "Acme"}
	got := Render("{% if company %}has{% else %}no{% endif %}", data, Options{})
	if got != "has" {
		t.Fatalf("got %q", got)
	}

	got = Render("{% if company %}has{% else %}no{% endif %}", Data{}, Options{})
	if got != "no" {
		t.Fatalf("got %q", got)
	}
}

func TestRenderUnless(t *testing.T) {
	got := Render("{% unless company %}no company{% endunless %}", Data{}, Options{})
	if got != "no company" {
		t.Fatalf("got %q", got)
	}
}

func TestRenderCase(t *testing.T) {
	data := Data{"plan": "pro"}
	got := Render("{% case plan %}{% when 'free' %}free{% when 'pro' %}pro{% else %}other{% endcase %}", data, Options{})
	if got != "pro" {
		t.Fatalf("got %q", got)
	}
}

func TestRenderSpintaxPicksOneOption(t *testing.T) {
	opts := Options{EnableSpintax: true, RandInt: deterministic(0)}
	got := Render("{one|two|three}", Data{}, opts)
	if got != "one" {
		t.Fatalf("got %q", got)
	}

	opts2 := Options{EnableSpintax: true, RandInt: deterministic(2)}
	got2 := Render("{one|two|three}", Data{}, opts2)
	if got2 != "three" {
		t.Fatalf("got %q", got2)
	}
}

func TestRenderSpintaxInsideOptionIsStillExpanded(t *testing.T) {
	opts := Options{EnableSpintax: true, RandInt: deterministic(0)}
	got := Render("{Hi {{first_name}}|Hello {{first_name}}}", Data{"first_name": "Zahid"}, opts)
	if got != "Hi Zahid" {
		t.Fatalf("got %q", got)
	}
}

func TestRenderLeavesUnbalancedBraceAlone(t *testing.T) {
	opts := Options{EnableSpintax: true, RandInt: deterministic(0)}
	got := Render("costs {50} per month", Data{}, opts)
	if got != "costs {50} per month" {
		t.Fatalf("got %q", got)
	}
}

func TestRenderLiquidTagIsNotTreatedAsSpintax(t *testing.T) {
	opts := Options{EnableSpintax: true, RandInt: deterministic(0)}
	got := Render("{% if company %}yes{% endif %}", Data{"company": "Acme"}, opts)
	if got != "yes" {
		t.Fatalf("got %q", got)
	}
}

func TestRenderDoesNotLeakAnyToken(t *testing.T) {
	tmpl := "Hi {{first_name}} from {{company}} — {{unknown_thing}}"
	got := Render(tmpl, Data{"first_name": "Zahid"}, Options{})
	for _, forbidden := range []string{"{{", "}}"} {
		if contains(got, forbidden) {
			t.Fatalf("rendered output still contains %q: %s", forbidden, got)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

func TestRenderMergeTagIsNotCorruptedBySpintax(t *testing.T) {
	// A merge tag next to ordinary text must survive intact.
	opts := Options{EnableSpintax: true, RandInt: deterministic(0)}
	got := Render("{{company}} — quick question for {{first_name}}",
		Data{"company": "Northwind Labs", "first_name": "Zahid"}, opts)
	want := "Northwind Labs — quick question for Zahid"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestRenderMergeTagWithPipeInsideIsNotSplit(t *testing.T) {
	opts := Options{EnableSpintax: true, RandInt: deterministic(0)}
	got := Render("{{a}} then {one|two}", Data{"a": "A"}, opts)
	if got != "A then one" {
		t.Fatalf("got %q", got)
	}
}

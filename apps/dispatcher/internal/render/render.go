// Package render expands campaign templates against a lead's data.
//
// Two syntaxes share the same pass:
//
//	{{ first_name }}                 merge variable, with a safe default
//	{{ company | default: "Acme" }}  Liquid-style filter
//	{% if company %}…{% else %}…{% endif %}
//	{Option A|Option B}              spintax
//
// The hard rule: a raw {{token}} must never reach a recipient. Every
// unresolvable token is replaced by a readable default (or removed).
package render

import (
	"math/rand"
	"strconv"
	"strings"
)

// Data is the variable set available to a template.
type Data map[string]string

// Options controls rendering behaviour.
type Options struct {
	// RandInt returns a value in [0,n). Injected so tests are deterministic.
	RandInt func(n int) int
	// EnableSpintax expands {a|b|c}. Off by default because a literal
	// brace in copy is common.
	EnableSpintax bool
}

func (o Options) randInt(n int) int {
	if o.RandInt != nil {
		return o.RandInt(n)
	}
	return rand.Intn(n)
}

// knownFallbacks is the readable substitute used when a variable resolves to
// nothing. A missing value should read naturally, not like a template.
var knownFallbacks = map[string]string{
	"first_name": "there",
	"last_name":  "",
	"company":    "your team",
	"title":      "",
	"industry":   "your industry",
	"city":       "",
	"country":    "",
	"email":      "",
	"phone":      "",
}

// Default returns the fallback used when a variable is unresolved.
func Default(name string) string {
	if v, ok := knownFallbacks[name]; ok {
		return v
	}
	return ""
}

// Render expands a template against the data.
func Render(tmpl string, data Data, opts Options) string {
	out := tmpl
	if opts.EnableSpintax {
		out = expandSpintax(out, opts.randInt)
	}
	out = renderLiquid(out, data)
	return out
}

/* -------------------------------------------------------------------------- */
/* Spintax                                                                    */
/* -------------------------------------------------------------------------- */

// expandSpintax replaces {option|option|option} with one randomly chosen
// option.
//
// Merge tags ({{…}}) and Liquid tags ({%…%}) are copied through untouched —
// they are not spintax, and a stray "|" inside one must not be treated as a
// choice separator. An unbalanced brace, or a group with no pipe, is left as
// literal text.
func expandSpintax(s string, randInt func(int) int) string {
	var b strings.Builder
	i := 0

	for i < len(s) {
		// Copy a merge tag verbatim.
		if strings.HasPrefix(s[i:], "{{") {
			end := strings.Index(s[i+2:], "}}")
			if end < 0 {
				b.WriteString(s[i:])
				break
			}
			stop := i + 2 + end + 2
			b.WriteString(s[i:stop])
			i = stop
			continue
		}

		// Copy a Liquid tag verbatim.
		if strings.HasPrefix(s[i:], "{%") {
			end := strings.Index(s[i+2:], "%}")
			if end < 0 {
				b.WriteString(s[i:])
				break
			}
			stop := i + 2 + end + 2
			b.WriteString(s[i:stop])
			i = stop
			continue
		}

		open := strings.IndexByte(s[i:], '{')
		if open < 0 {
			b.WriteString(s[i:])
			break
		}
		open += i

		end, options, ok := parseSpintax(s, open)
		if !ok {
			// Not a choice — keep the brace and carry on.
			b.WriteString(s[i : open+1])
			i = open + 1
			continue
		}

		b.WriteString(s[i:open])
		b.WriteString(options[randInt(len(options))])
		i = end + 1
	}

	return b.String()
}

// parseSpintax finds the closing brace for the group starting at `open` and
// splits it into top-level options. It returns the index of the closing brace.
// A group needs at least one "|" to be a choice; "{50}" is literal text.
func parseSpintax(s string, open int) (int, []string, bool) {
	depth := 0
	var options []string
	start := open + 1
	sawPipe := false

	for i := open; i < len(s); i++ {
		switch s[i] {
		case '{':
			depth++
			if depth == 1 {
				start = i + 1
			}
		case '}':
			depth--
			if depth == 0 {
				options = append(options, s[start:i])
				if !sawPipe || len(options) < 2 {
					return 0, nil, false
				}
				return i, options, true
			}
		case '|':
			if depth == 1 {
				sawPipe = true
				options = append(options, s[start:i])
				start = i + 1
			}
		}
	}

	return 0, nil, false
}

/* -------------------------------------------------------------------------- */
/* Liquid-ish evaluation                                                       */
/* -------------------------------------------------------------------------- */

type tokenKind int

const (
	tokText tokenKind = iota
	tokOutput
	tokTag
)

type token struct {
	kind tokenKind
	text string
}

func tokenize(s string) []token {
	var out []token
	i := 0

	for i < len(s) {
		relOut := strings.Index(s[i:], "{{")
		relTag := strings.Index(s[i:], "{%")

		next := -1
		isTag := false
		switch {
		case relOut >= 0 && (relTag < 0 || relOut <= relTag):
			next = i + relOut
		case relTag >= 0:
			next = i + relTag
			isTag = true
		}

		if next < 0 {
			out = append(out, token{kind: tokText, text: s[i:]})
			break
		}

		if next > i {
			out = append(out, token{kind: tokText, text: s[i:next]})
		}

		closer := "}}"
		if isTag {
			closer = "%}"
		}
		end := strings.Index(s[next+2:], closer)
		if end < 0 {
			out = append(out, token{kind: tokText, text: s[next:]})
			break
		}

		body := s[next+2 : next+2+end]
		if isTag {
			out = append(out, token{kind: tokTag, text: strings.TrimSpace(body)})
		} else {
			out = append(out, token{kind: tokOutput, text: strings.TrimSpace(body)})
		}
		i = next + 2 + end + 2
	}

	return out
}

type frame struct {
	kind     string // "if", "unless", "case"
	parentOn bool
	anyTaken bool
	caseVal  string
}

func renderLiquid(s string, data Data) string {
	tokens := tokenize(s)
	var b strings.Builder
	var stack []frame

	active := func() bool {
		for _, f := range stack {
			if !f.anyTaken {
				return false
			}
		}
		return true
	}

	push := func(f frame) { stack = append(stack, f) }
	pop := func() {
		if len(stack) > 0 {
			stack = stack[:len(stack)-1]
		}
	}
	top := func() *frame {
		if len(stack) == 0 {
			return nil
		}
		return &stack[len(stack)-1]
	}

	for _, t := range tokens {
		switch t.kind {
		case tokText:
			if active() {
				b.WriteString(t.text)
			}

		case tokOutput:
			if active() {
				b.WriteString(evalOutput(t.text, data))
			}

		case tokTag:
			name, args := splitTag(t.text)
			switch name {
			case "if", "unless":
				parent := active()
				cond := truthy(evalCondition(args, data))
				if name == "unless" {
					cond = !cond
				}
				push(frame{kind: name, parentOn: parent, anyTaken: parent && cond})

			case "else":
				if f := top(); f != nil {
					f.anyTaken = f.parentOn && !f.anyTaken
				}

			case "endif", "endunless":
				pop()

			case "case":
				parent := active()
				push(frame{
					kind:     "case",
					parentOn: parent,
					caseVal:  evalCondition(args, data),
				})

			case "when":
				if f := top(); f != nil && f.kind == "case" {
					matched := f.parentOn && !f.anyTaken &&
						f.caseVal == evalCondition(args, data)
					if matched {
						f.anyTaken = true
					}
				}

			case "endcase":
				pop()
			}
		}
	}

	return b.String()
}

func splitTag(s string) (string, string) {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, " \t\n"); i >= 0 {
		return s[:i], strings.TrimSpace(s[i+1:])
	}
	return s, ""
}

// unquote strips matching surrounding quotes so a literal like 'pro' compares
// as the string pro.
func unquote(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 {
		first, last := s[0], s[len(s)-1]
		if (first == '\'' && last == '\'') || (first == '"' && last == '"') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

// evalCondition resolves an expression for use in a condition. It uses the
// RAW value with no readable fallback: a missing variable must be falsy, or
// "{% if company %}" would be true for every lead.
func evalCondition(expr string, data Data) string {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return ""
	}

	parts := strings.Split(expr, "|")
	name := strings.TrimSpace(parts[0])
	value, present := data[name]
	if !present {
		value = ""
	}

	for _, raw := range parts[1:] {
		filter := strings.TrimSpace(raw)
		switch {
		case strings.HasPrefix(filter, "default:"):
			if value == "" {
				value = unquote(strings.TrimSpace(filter[len("default:"):]))
			}
		case filter == "upcase":
			value = strings.ToUpper(value)
		case filter == "downcase":
			value = strings.ToLower(value)
		case filter == "strip":
			value = strings.TrimSpace(value)
		}
	}

	// A bare quoted literal is a constant, not a variable name.
	if _, present := data[name]; !present && isQuoted(name) {
		return unquote(name)
	}

	return value
}

func isQuoted(s string) bool {
	if len(s) < 2 {
		return false
	}
	first, last := s[0], s[len(s)-1]
	return (first == '\'' && last == '\'') || (first == '"' && last == '"')
}

// evalOutput resolves an expression for display. The readable fallback is
// applied only after the filters, so an explicit `default:` wins over it.
func evalOutput(expr string, data Data) string {
	parts := strings.Split(expr, "|")
	name := strings.TrimSpace(parts[0])

	value, present := data[name]
	if !present {
		value = ""
	}

	for _, raw := range parts[1:] {
		filter := strings.TrimSpace(raw)
		switch {
		case strings.HasPrefix(filter, "default:"):
			if value == "" {
				value = unquote(strings.TrimSpace(filter[len("default:"):]))
			}
		case filter == "upcase":
			value = strings.ToUpper(value)
		case filter == "downcase":
			value = strings.ToLower(value)
		case filter == "strip":
			value = strings.TrimSpace(value)
		}
	}

	if value == "" {
		value = Default(name)
	}

	return value
}

func truthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", "false", "0", "nil", "null":
		return false
	}
	return true
}

// ParseInt is a small helper used by callers that need the numeric form of a
// variable.
func ParseInt(s string) (int, bool) {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	return n, err == nil
}

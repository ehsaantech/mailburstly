package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/mailrung/dispatcher/internal/render"
)

// Server holds the HTTP router and dependencies.
type Server struct {
	Router *chi.Mux
	Health func() (map[string]any, error)
}

// RenderRequest is a template and the data to render it against.
type RenderRequest struct {
	// The template text. May be a subject or a body.
	Template string `json:"template"`
	// The merge variables, by name.
	Data map[string]string `json:"data"`
	// Expand spintax. Off by default, because a preview that changes
	// every time it is rendered is not a preview.
	Spintax bool `json:"spintax"`
}

// RenderResponse is the rendered text.
type RenderResponse struct {
	Rendered string `json:"rendered"`
}

// New creates a chi router with health and render endpoints.
func New(health func() (map[string]any, error)) *Server {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)

	s := &Server{Router: r, Health: health}

	r.Get("/healthz", s.handleHealth)
	r.Get("/readyz", s.handleHealth)
	r.Post("/render", s.handleRender)

	return s
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	data, err := s.Health()
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"status": "error", "error": err.Error()})
		return
	}
	status := http.StatusOK
	if v, ok := data["status"]; ok && v != "ok" {
		status = http.StatusServiceUnavailable
	}
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// handleRender renders a template against merge variables.
//
// The renderer lives here, in the dispatcher, because the dispatcher is
// what sends the real message. A preview rendered anywhere else could
// disagree with what actually goes out — and a preview that shows a
// {{token}} the real email would not is worse than no preview at all.
func (s *Server) handleRender(w http.ResponseWriter, r *http.Request) {
	var req RenderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"error": "invalid json"})
		return
	}

	if strings.TrimSpace(req.Template) == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"error": "template is required"})
		return
	}

	data := render.Data{}
	for k, v := range req.Data {
		data[k] = v
	}

	out := render.Render(req.Template, data, render.Options{
		EnableSpintax: req.Spintax,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(RenderResponse{Rendered: out})
}

// ListenAndServe starts the HTTP server.
func (s *Server) ListenAndServe(addr string) error {
	return http.ListenAndServe(addr, s.Router)
}

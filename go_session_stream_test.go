package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRegressionLoginFailureTrackingHasFiniteCapacity(t *testing.T) {
	a := mustAuthenticator("known-strong-password", "http://panel.test")
	for i := 0; i < 2048; i++ {
		r := httptest.NewRequest(http.MethodPost, "http://panel.test/api/v1/auth/login", nil)
		r.RemoteAddr = fmt.Sprintf("10.0.%d.%d:1234", i/256, i%256)
		r.Header.Set("Origin", "http://panel.test")
		_, _, err := a.login(r, "admin", "incorrect-password")
		if err == nil {
			t.Fatal("incorrect password accepted")
		}
	}
	a.mu.Lock()
	retained := len(a.failures)
	a.mu.Unlock()
	if retained > 1024 {
		t.Fatalf("distinct failed logins retain unbounded client state: %d entries", retained)
	}
	// Filling the tracking table must not lock the real administrator out.
	r := httptest.NewRequest(http.MethodPost, "http://panel.test/api/v1/auth/login", nil)
	r.RemoteAddr = "192.0.2.8:1234"
	r.Header.Set("Origin", "http://panel.test")
	if _, _, err := a.login(r, "admin", "known-strong-password"); err != nil {
		t.Fatalf("valid login blocked at capacity: %v", err)
	}
}

func TestRegressionConsoleStreamStopsAtLogoutOrExpiry(t *testing.T) {
	for _, reason := range []string{"logout", "expiry"} {
		t.Run(reason, func(t *testing.T) {
			m, id := regressionManager(t)
			a,apiErr:=newPanelAPI(m, "http://placeholder.test", "known-strong-password")
 if apiErr!=nil{panic(apiErr)}
			server := httptest.NewServer(a)
			a.auth.origin = server.URL
			t.Cleanup(func() { a.closeStreams(); server.Close() })
			request, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/login", bytes.NewBufferString(`{"password":"known-strong-password"}`))
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Origin", server.URL)
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != 200 {
				t.Fatalf("login failed: %d", response.StatusCode)
			}
			var login struct {
				CSRF string `json:"csrf"`
			}
			if err := json.NewDecoder(response.Body).Decode(&login); err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			cookie := response.Cookies()[0]
			if reason == "expiry" {
				a.auth.mu.Lock()
				session := a.auth.sessions[cookie.Value]
				session.expires = time.Now().Add(120 * time.Millisecond)
				a.auth.sessions[cookie.Value] = session
				a.auth.mu.Unlock()
			}
			request, err = http.NewRequest(http.MethodGet, server.URL+"/api/v1/servers/"+id+"/logs/stream", nil)
			if err != nil {
				t.Fatal(err)
			}
			request.AddCookie(cookie)
			stream, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Body.Close()
			if stream.StatusCode != 200 {
				t.Fatalf("stream open: %d", stream.StatusCode)
			}
			reader := bufio.NewReader(stream.Body)
			if _, err := reader.ReadString('\n'); err != nil {
				t.Fatal(err)
			}
			drained := make(chan error, 1)
			go func() { _, err := io.Copy(io.Discard, reader); drained <- err }()
			if reason == "logout" {
				request, err = http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/logout", nil)
				if err != nil {
					t.Fatal(err)
				}
				request.AddCookie(cookie)
				request.Header.Set("Origin", server.URL)
				request.Header.Set("X-CSRF-Token", login.CSRF)
				out, err := http.DefaultClient.Do(request)
				if err != nil {
					t.Fatal(err)
				}
				out.Body.Close()
				if out.StatusCode != 200 {
					t.Fatalf("logout: %d", out.StatusCode)
				}
			}
			select {
			case err := <-drained:
				if err != nil {
					t.Fatalf("stream closed with transport error: %v", err)
				}
			case <-time.After(900 * time.Millisecond):
				t.Fatalf("authenticated log stream remained open after %s", reason)
			}
			m.mu.Lock()
			subscribers := len(m.servers[id].subscribers)
			m.mu.Unlock()
			if subscribers != 0 {
				t.Errorf("revoked stream leaked subscription: %d", subscribers)
			}
		})
	}
}

// The writer is a boundary spy: it records whether the handler bounds actual
// network writes, rather than testing how net/http implements deadlines.
type streamDeadlineWriter struct {
	header  http.Header
	cancel  func()
	bounded bool
}

func (w *streamDeadlineWriter) Header() http.Header         { return w.header }
func (w *streamDeadlineWriter) WriteHeader(int)             {}
func (w *streamDeadlineWriter) Write(p []byte) (int, error) { w.cancel(); return len(p), nil }
func (w *streamDeadlineWriter) Flush()                      {}
func (w *streamDeadlineWriter) SetWriteDeadline(d time.Time) error {
	if !d.IsZero() && time.Until(d) > 0 && time.Until(d) <= 6*time.Second {
		w.bounded = true
	}
	return nil
}

func TestRegressionConsoleStreamBoundsNetworkWrites(t *testing.T) {
	m, id := regressionManager(t)
	a,apiErr:=newPanelAPI(m, "http://panel.test", "known-strong-password")
 if apiErr!=nil{panic(apiErr)}
	login := httptest.NewRequest(http.MethodPost, "http://panel.test/api/v1/auth/login", nil)
	login.Header.Set("Origin", "http://panel.test")
	token, _, err := a.auth.login(login, "admin", "known-strong-password")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := httptest.NewRequest(http.MethodGet, "http://panel.test/api/v1/servers/"+id+"/logs/stream", nil).WithContext(ctx)
	r.AddCookie(a.auth.cookie(token))
	w := &streamDeadlineWriter{header: make(http.Header), cancel: cancel}
	if err := a.sse(w, r, id); err != nil {
		t.Fatal(err)
	}
	if !w.bounded {
		t.Fatal("SSE writes have no deadline: a slow client can hold the handler indefinitely")
	}
}

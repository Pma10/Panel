package main

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxFailedLoginClients = 1024
const maxUsers = 64

// passwordIterations is a var only so tests can lower the PBKDF2 cost.
var passwordIterations = 210000

// apiError carries an intentional HTTP status and a safe user-facing message.
type apiError struct {
	Status  int
	Message string
}

func (e apiError) Error() string { return e.Message }

type authSession struct {
	username string
	csrf     string
	expires  time.Time
	revoked  chan struct{}
}

type failureCount struct {
	count   int
	expires time.Time
}

type userRecord struct {
	Username   string `json:"username"`
	Salt       string `json:"salt"`
	Hash       string `json:"hash"`
	Iterations int    `json:"iterations"`
	Created    string `json:"created"`
}

type authenticator struct {
	mu        sync.Mutex
	usersPath string // empty keeps accounts in memory only (tests)
	users     map[string]userRecord
	origin    string
	secure    bool
	sessions  map[string]authSession
	failures  map[string]failureCount
	nextPrune time.Time
}

// newAuthenticator loads accounts from usersPath. When no account exists and
// bootstrapPassword is set (legacy PANEL_ADMIN_PASSWORD), an "admin" account
// is created from it so existing deployments keep working.
func newAuthenticator(usersPath, bootstrapPassword, origin string) (*authenticator, error) {
	a := &authenticator{
		usersPath: usersPath, users: map[string]userRecord{}, origin: origin,
		secure:   strings.HasPrefix(origin, "https://"),
		sessions: map[string]authSession{}, failures: map[string]failureCount{},
	}
	if usersPath != "" {
		buf, err := os.ReadFile(usersPath)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
		if len(buf) > 0 {
			var list []userRecord
			if err := json.Unmarshal(buf, &list); err != nil {
				return nil, errors.New("invalid users.json: " + err.Error())
			}
			for _, u := range list {
				if validUsername(u.Username) {
					a.users[u.Username] = u
				}
			}
		}
	}
	if len(a.users) == 0 && len(bootstrapPassword) >= 12 {
		a.mu.Lock()
		err := a.addUserLocked("admin", bootstrapPassword)
		a.mu.Unlock()
		if err != nil {
			return nil, err
		}
	}
	return a, nil
}

func secureToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func hashPassword(password string, salt []byte, iterations int) []byte {
	key, err := pbkdf2.Key(sha256.New, password, salt, iterations, 32)
	if err != nil {
		panic(err)
	}
	return key
}

func validUsername(name string) bool {
	if len(name) < 3 || len(name) > 32 {
		return false
	}
	for _, r := range name {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.') {
			return false
		}
	}
	return true
}

func validPassword(password string) error {
	if len(password) < 12 {
		return apiError{400, "비밀번호는 12자 이상이어야 합니다."}
	}
	if len(password) > 4096 {
		return apiError{400, "비밀번호가 너무 깁니다."}
	}
	return nil
}

func clientIP(req *http.Request) string {
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		return req.RemoteAddr
	}
	return host
}

func (a *authenticator) originAllowed(r *http.Request) bool {
	return r.Header.Get("Origin") == a.origin
}

func (a *authenticator) cookie(token string) *http.Cookie {
	return &http.Cookie{Name: "pconn_session", Value: token, Path: "/", HttpOnly: true, Secure: a.secure,
		SameSite: http.SameSiteStrictMode, MaxAge: 8 * 3600}
}

func (a *authenticator) saveUsersLocked() error {
	if a.usersPath == "" {
		return nil
	}
	list := make([]userRecord, 0, len(a.users))
	for _, u := range a.users {
		list = append(list, u)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Username < list[j].Username })
	buf, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(a.usersPath), ".panel-users-"+makeID()+".tmp")
	if err := os.WriteFile(tmp, buf, 0600); err != nil {
		return err
	}
	if err := os.Rename(tmp, a.usersPath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// addUserLocked hashes under the lock; account creation is rare and admin-only.
func (a *authenticator) addUserLocked(username, password string) error {
	if !validUsername(username) {
		return apiError{400, "아이디는 3~32자의 영문, 숫자, _ - . 만 사용할 수 있습니다."}
	}
	if err := validPassword(password); err != nil {
		return err
	}
	if _, exists := a.users[username]; exists {
		return apiError{409, "이미 존재하는 아이디입니다."}
	}
	if len(a.users) >= maxUsers {
		return apiError{409, "계정 수 제한을 초과했습니다."}
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	a.users[username] = userRecord{
		Username: username, Salt: hex.EncodeToString(salt),
		Hash:       hex.EncodeToString(hashPassword(password, salt, passwordIterations)),
		Iterations: passwordIterations, Created: time.Now().UTC().Format(time.RFC3339),
	}
	if err := a.saveUsersLocked(); err != nil {
		delete(a.users, username)
		return err
	}
	return nil
}

// verify compares outside the mutex so a slow PBKDF2 does not stall every
// authenticated request waiting on session lookups.
func verifyPassword(u userRecord, known bool, password string) bool {
	salt, _ := hex.DecodeString(u.Salt)
	expected, _ := hex.DecodeString(u.Hash)
	iterations := u.Iterations
	if !known || iterations < 1 {
		salt, expected, iterations = []byte("panel-dummy-salt"), make([]byte, 32), passwordIterations
	}
	got := hashPassword(password, salt, iterations)
	return known && subtle.ConstantTimeCompare(got, expected) == 1
}

// revokeLocked wakes all SSE streams using the session. Deletion and channel
// closure happen under the same lock so expiry and logout cannot double-close.
func (a *authenticator) revokeLocked(token string) {
	if s, ok := a.sessions[token]; ok {
		if s.revoked != nil {
			close(s.revoked)
		}
		delete(a.sessions, token)
	}
}

// Cleanup cost is bounded and amortized, not an O(client-count) scan on every
// failed password. Unknown clients cannot grow the failure table indefinitely.
func (a *authenticator) pruneLocked(now time.Time) {
	if now.Before(a.nextPrune) {
		return
	}
	for token, session := range a.sessions {
		if !now.Before(session.expires) {
			a.revokeLocked(token)
		}
	}
	for ip, f := range a.failures {
		if !now.Before(f.expires) {
			delete(a.failures, ip)
		}
	}
	a.nextPrune = now.Add(time.Minute)
}

func (a *authenticator) newSessionLocked(username string, now time.Time) (string, string, error) {
	if len(a.sessions) >= 128 {
		// Avoid denying valid users just because expired sessions have not
		// reached the periodic pruning interval yet.
		for token, session := range a.sessions {
			if !now.Before(session.expires) {
				a.revokeLocked(token)
			}
		}
		if len(a.sessions) >= 128 {
			return "", "", apiError{503, "로그인 세션 수가 너무 많습니다."}
		}
	}
	token, csrf := secureToken(), secureToken()
	a.sessions[token] = authSession{username: username, csrf: csrf, expires: now.Add(8 * time.Hour), revoked: make(chan struct{})}
	return token, csrf, nil
}

func (a *authenticator) login(r *http.Request, username, password string) (string, string, error) {
	if !a.originAllowed(r) {
		return "", "", apiError{403, "요청 출처가 일치하지 않습니다."}
	}
	if username == "" {
		username = "admin" // legacy password-only clients
	}
	if len(password) > 4096 || len(username) > 64 {
		return "", "", apiError{400, "아이디 또는 비밀번호가 너무 깁니다."}
	}
	a.mu.Lock()
	now := time.Now()
	a.pruneLocked(now)
	ip := clientIP(r)
	if current, tracked := a.failures[ip]; tracked && current.count >= 8 && now.Before(current.expires) {
		a.mu.Unlock()
		return "", "", apiError{429, "로그인 시도가 너무 많습니다."}
	}
	user, known := a.users[username]
	a.mu.Unlock()

	match := verifyPassword(user, known, password)

	a.mu.Lock()
	defer a.mu.Unlock()
	if current, still := a.users[username]; !still || current.Hash != user.Hash {
		match = false // deleted or password changed while hashing
	}
	if !match {
		current, tracked := a.failures[ip]
		if tracked && !now.Before(current.expires) {
			current, tracked = failureCount{}, false
		}
		if !tracked && len(a.failures) >= maxFailedLoginClients {
			return "", "", apiError{429, "로그인 시도가 많습니다. 잠시 후 다시 시도하세요."}
		}
		current.count++
		current.expires = now.Add(5 * time.Minute)
		a.failures[ip] = current
		return "", "", apiError{401, "아이디 또는 비밀번호가 일치하지 않습니다."}
	}
	delete(a.failures, ip)
	return a.newSessionLocked(username, now)
}

func (a *authenticator) setupRequired() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.users) == 0
}

// setup creates the first account. It is only possible while no account
// exists, so it cannot be used to add accounts to a configured panel.
func (a *authenticator) setup(r *http.Request, username, password string) (string, string, error) {
	if !a.originAllowed(r) {
		return "", "", apiError{403, "요청 출처가 일치하지 않습니다."}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.users) > 0 {
		return "", "", apiError{409, "이미 계정이 설정되어 있습니다. 로그인하세요."}
	}
	if err := a.addUserLocked(username, password); err != nil {
		return "", "", err
	}
	return a.newSessionLocked(username, time.Now())
}

func (a *authenticator) listUsers() []map[string]string {
	a.mu.Lock()
	defer a.mu.Unlock()
	result := []map[string]string{}
	for _, u := range a.users {
		result = append(result, map[string]string{"username": u.Username, "created": u.Created})
	}
	sort.Slice(result, func(i, j int) bool { return result[i]["username"] < result[j]["username"] })
	return result
}

func (a *authenticator) createUser(username, password string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.addUserLocked(username, password)
}

func (a *authenticator) deleteUser(username, actor string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	old, ok := a.users[username]
	if !ok {
		return apiError{404, "계정을 찾을 수 없습니다."}
	}
	if username == actor {
		return apiError{409, "현재 로그인한 계정은 삭제할 수 없습니다."}
	}
	if len(a.users) <= 1 {
		return apiError{409, "마지막 계정은 삭제할 수 없습니다."}
	}
	delete(a.users, username)
	if err := a.saveUsersLocked(); err != nil {
		a.users[username] = old
		return err
	}
	for token, s := range a.sessions {
		if s.username == username {
			a.revokeLocked(token)
		}
	}
	return nil
}

// changePassword keeps the caller's session and revokes their other sessions.
func (a *authenticator) changePassword(token, username, current, next string) error {
	if err := validPassword(next); err != nil {
		return err
	}
	a.mu.Lock()
	user, known := a.users[username]
	a.mu.Unlock()
	if !verifyPassword(user, known, current) {
		return apiError{403, "현재 비밀번호가 일치하지 않습니다."}
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	hash := hex.EncodeToString(hashPassword(next, salt, passwordIterations))
	a.mu.Lock()
	defer a.mu.Unlock()
	if latest, still := a.users[username]; !still || latest.Hash != user.Hash {
		return apiError{409, "계정 정보가 변경되었습니다. 다시 시도하세요."}
	}
	updated := user
	updated.Salt, updated.Hash, updated.Iterations = hex.EncodeToString(salt), hash, passwordIterations
	a.users[username] = updated
	if err := a.saveUsersLocked(); err != nil {
		a.users[username] = user
		return err
	}
	for t, s := range a.sessions {
		if s.username == username && t != token {
			a.revokeLocked(t)
		}
	}
	return nil
}

// resetPassword replaces an account's password with a random one and ends
// its sessions. Used by the --reset-password command for lost passwords.
func (a *authenticator) resetPassword(username string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	user, ok := a.users[username]
	if !ok {
		names := []string{}
		for name := range a.users {
			names = append(names, name)
		}
		sort.Strings(names)
		return "", fmt.Errorf("no account %q (accounts: %s)", username, strings.Join(names, ", "))
	}
	password := secureToken()[:20]
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	updated := user
	updated.Salt = hex.EncodeToString(salt)
	updated.Hash = hex.EncodeToString(hashPassword(password, salt, passwordIterations))
	updated.Iterations = passwordIterations
	a.users[username] = updated
	if err := a.saveUsersLocked(); err != nil {
		a.users[username] = user
		return "", err
	}
	for token, s := range a.sessions {
		if s.username == username {
			a.revokeLocked(token)
		}
	}
	return password, nil
}

func (a *authenticator) session(r *http.Request) (string, authSession, error) {
	cookie, err := r.Cookie("pconn_session")
	if err != nil || len(cookie.Value) != 64 {
		return "", authSession{}, apiError{401, "로그인해야 합니다."}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	s, ok := a.sessions[cookie.Value]
	if !ok || !time.Now().Before(s.expires) {
		a.revokeLocked(cookie.Value)
		return "", authSession{}, apiError{401, "세션이 만료됐습니다."}
	}
	return cookie.Value, s, nil
}

func (a *authenticator) requireMutation(r *http.Request, s authSession) error {
	if !a.originAllowed(r) {
		return apiError{403, "허용하지 않은 출처입니다."}
	}
	given := r.Header.Get("X-Csrf-Token")
	if len(given) != len(s.csrf) || subtle.ConstantTimeCompare([]byte(given), []byte(s.csrf)) != 1 {
		return apiError{403, "CSRF 검증에 실패했습니다."}
	}
	return nil
}

func (a *authenticator) logout(token string) {
	a.mu.Lock()
	a.revokeLocked(token)
	a.mu.Unlock()
}

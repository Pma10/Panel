package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
)

// Keep PBKDF2 cheap in tests; thousands of failed logins are exercised.
func init() {
	passwordIterations = 1000
	// Tests must not leave fake servers running after their manager shuts down.
	stopServersOnShutdown = true
}

func mustAuthenticator(password, origin string) *authenticator {
	a, err := newAuthenticator("", password, origin)
	if err != nil {
		panic(err)
	}
	return a
}

// saveResumeList writes the restart list that panels before server
// reattachment left behind on shutdown; resumePending still reads it once.
func (m *manager) saveResumeList(ids []string) error {
	target := filepath.Join(m.root, ".panel-resume.json")
	if len(ids) == 0 {
		if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	if len(ids) > 100 {
		return errors.New("resume list exceeds 100 managed servers")
	}
	data, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	temp := target + "." + makeID() + ".tmp"
	if err := os.WriteFile(temp, data, 0600); err != nil {
		return err
	}
	if err := os.Rename(temp, target); err != nil {
		_ = os.Remove(temp)
		return err
	}
	return nil
}

// scanLines feeds a reader through the bounded console line parser.
func scanLines(r io.Reader, cb func(string)) {
	writer := &boundedConsoleWriter{writeLog: cb}
	_, err := io.CopyBuffer(writer, r, make([]byte, 32*1024))
	writer.Flush()
	if err != nil {
		cb("[console read error: " + err.Error() + "]")
	}
}

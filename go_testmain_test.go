package main

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

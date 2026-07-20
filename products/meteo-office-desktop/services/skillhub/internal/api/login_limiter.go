package api

import (
	"net"
	"strings"
	"sync"
	"time"
)

const (
	loginFailureLimit = 5
	loginWindow       = 5 * time.Minute
	loginBlock        = 5 * time.Minute
)

type loginAttempt struct {
	Failures     int
	WindowStart  time.Time
	BlockedUntil time.Time
}

type loginLimiter struct {
	mu       sync.Mutex
	attempts map[string]loginAttempt
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{attempts: map[string]loginAttempt{}}
}

func loginAttemptKey(remote, username string) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(remote))
	if err != nil {
		host = strings.TrimSpace(remote)
	}
	return strings.ToLower(strings.TrimSpace(username)) + "\n" + host
}

func (l *loginLimiter) allow(key string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	current, ok := l.attempts[key]
	if !ok {
		return true, 0
	}
	if current.BlockedUntil.After(now) {
		return false, current.BlockedUntil.Sub(now)
	}
	if now.Sub(current.WindowStart) >= loginWindow {
		delete(l.attempts, key)
	}
	return true, 0
}

func (l *loginLimiter) failed(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	current := l.attempts[key]
	if current.WindowStart.IsZero() || now.Sub(current.WindowStart) >= loginWindow {
		current = loginAttempt{WindowStart: now}
	}
	current.Failures++
	if current.Failures >= loginFailureLimit {
		current.BlockedUntil = now.Add(loginBlock)
	}
	l.attempts[key] = current
	if len(l.attempts) > 10_000 {
		for attemptKey, attempt := range l.attempts {
			if !attempt.BlockedUntil.After(now) && now.Sub(attempt.WindowStart) >= loginWindow {
				delete(l.attempts, attemptKey)
			}
		}
	}
}

func (l *loginLimiter) succeeded(key string) {
	l.mu.Lock()
	delete(l.attempts, key)
	l.mu.Unlock()
}

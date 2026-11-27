package main

import (
	"strings"
	"testing"
)

func TestConsoleDrainsUnboundedLinesWithoutGrowingMemory(t *testing.T) {
	payload := strings.Repeat("L", 2*1024*1024) + "\nAFTER-LONG-LINE\n"
	result := []string{}
	scanLines(strings.NewReader(payload), func(line string) { result = append(result, line) })
	if len(result) != 2 {
		t.Fatalf("expected two lines; got %d", len(result))
	}
	if !strings.Contains(result[0], "로그 행 길이 제한") {
		t.Fatalf("long line was not marked truncated: %q", result[0])
	}
	if len(result[0]) > 2150 {
		t.Fatalf("oversized console string retained: %d", len(result[0]))
	}
	if result[1] != "AFTER-LONG-LINE" {
		t.Fatalf("following line was lost: %q", result[1])
	}
}

func TestConsoleAllowsEmptyAndFinalUnterminatedLines(t *testing.T) {
	result := []string{}
	scanLines(strings.NewReader("\nhello\nlast"), func(line string) { result = append(result, line) })
	if len(result) != 2 || result[0] != "hello" || result[1] != "last" {
		t.Fatalf("unexpected lines: %#v", result)
	}
}

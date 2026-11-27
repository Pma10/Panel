package main

import (
	"strings"
	"testing"
)

func TestConsoleWriterDrainsHugeLines(t *testing.T) {
	got := []string{}
	writer := &boundedConsoleWriter{writeLog: func(line string) { got = append(got, line) }}
	_, err := writer.Write([]byte(strings.Repeat("x", 2<<20) + "\nnext\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || len(got[0]) > 2200 || !strings.Contains(got[0], "생략됨") || got[1] != "next" {
		t.Fatalf("unexpected bounded logs: length=%d", len(got))
	}
}

func TestConsoleWriterReconstructsPartialLines(t *testing.T) {
	got := []string{}
	writer := &boundedConsoleWriter{writeLog: func(line string) { got = append(got, line) }}
	_, _ = writer.Write([]byte("hel"))
	_, _ = writer.Write([]byte("lo\nwor"))
	_, _ = writer.Write([]byte("ld"))
	writer.Flush()
	if len(got) != 2 || got[0] != "hello" || got[1] != "world" {
		t.Fatalf("partial lines: %#v", got)
	}
}

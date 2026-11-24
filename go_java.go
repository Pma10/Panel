package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// defaultStartCommand reproduces the historical fixed launch line.
// The line is split on whitespace ("double quotes" group an argument) and
// placeholders are substituted per argument, so a Java path containing
// spaces stays one argument. No shell is used.
const defaultStartCommand = "{java} -Xms512M -Xmx{memory}M -jar {jar} nogui"

type javaInstall struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	Source  string `json:"source"`
}

var javaVersionPattern = regexp.MustCompile(`version "([^"]+)"`)

func javaExecutableName() string {
	if runtime.GOOS == "windows" {
		return "java.exe"
	}
	return "java"
}

func javaCandidateGlobs() []string {
	exe := javaExecutableName()
	home, _ := os.UserHomeDir()
	globs := []string{}
	if runtime.GOOS == "windows" {
		for _, base := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")} {
			if base == "" {
				continue
			}
			for _, vendor := range []string{"Java", "Eclipse Adoptium", "Eclipse Foundation", "Zulu", "Microsoft", "Amazon Corretto", "BellSoft", "Semeru"} {
				globs = append(globs, filepath.Join(base, vendor, "*", "bin", exe))
			}
		}
	} else {
		globs = append(globs, "/usr/lib/jvm/*/bin/java", "/usr/java/*/bin/java", "/opt/java/*/bin/java",
			"/opt/*/bin/java", "/usr/local/opt/openjdk*/bin/java",
			"/Library/Java/JavaVirtualMachines/*/Contents/Home/bin/java")
	}
	if home != "" {
		globs = append(globs, filepath.Join(home, ".sdkman", "candidates", "java", "*", "bin", exe),
			filepath.Join(home, ".jdks", "*", "bin", exe))
	}
	return globs
}

// detectJava lists Java runtimes found on the host. It runs each binary with
// -version (bounded by a timeout) so the UI can show what it actually is.
func detectJava(ctx context.Context, configured string) []javaInstall {
	type candidate struct{ path, source string }
	seen := map[string]bool{}
	list := []candidate{}
	add := func(path, source string) {
		if path == "" || len(list) >= 32 {
			return
		}
		if !filepath.IsAbs(path) {
			found, err := exec.LookPath(path)
			if err != nil {
				return
			}
			path = found
		}
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil {
			return
		}
		if info, err := os.Stat(resolved); err != nil || !info.Mode().IsRegular() {
			return
		}
		if seen[resolved] {
			return
		}
		seen[resolved] = true
		list = append(list, candidate{path, source})
	}
	add(configured, "PANEL_JAVA_BIN")
	if home := os.Getenv("JAVA_HOME"); home != "" {
		add(filepath.Join(home, "bin", javaExecutableName()), "JAVA_HOME")
	}
	add("java", "PATH")
	for _, pattern := range javaCandidateGlobs() {
		matches, _ := filepath.Glob(pattern)
		for _, m := range matches {
			add(m, "검색")
		}
	}
	result := make([]javaInstall, len(list))
	var wg sync.WaitGroup
	for i, c := range list {
		wg.Add(1)
		go func(i int, c candidate) {
			defer wg.Done()
			result[i] = javaInstall{Path: c.path, Source: c.source, Version: javaVersion(ctx, c.path)}
		}(i, c)
	}
	wg.Wait()
	return result
}

func javaVersion(ctx context.Context, path string) string {
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, "-version").CombinedOutput()
	if err != nil && len(out) == 0 {
		return "확인 불가"
	}
	if m := javaVersionPattern.FindSubmatch(out); m != nil {
		return string(m[1])
	}
	first, _, _ := strings.Cut(strings.TrimSpace(string(out)), "\n")
	if len(first) > 80 {
		first = first[:80]
	}
	return first
}

func validJavaBin(path string) bool {
	if path == "" {
		return true // use the panel default
	}
	if len(path) > 1024 || strings.ContainsAny(path, "\r\n\x00") {
		return false
	}
	if !filepath.IsAbs(path) {
		return path == "java"
	}
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func validStartCommand(command string) bool {
	if command == "" {
		return true
	}
	if len(command) > 2048 || strings.ContainsAny(command, "\r\n\x00") {
		return false
	}
	return len(splitCommand(command)) > 0
}

// splitCommand splits on whitespace; double quotes group one argument.
func splitCommand(line string) []string {
	args := []string{}
	var cur strings.Builder
	quoted, inArg := false, false
	for _, r := range line {
		switch {
		case r == '"':
			quoted, inArg = !quoted, true
		case !quoted && (r == ' ' || r == '\t'):
			if inArg {
				args = append(args, cur.String())
				cur.Reset()
				inArg = false
			}
		default:
			cur.WriteRune(r)
			inArg = true
		}
	}
	if inArg {
		args = append(args, cur.String())
	}
	return args
}

// buildStartArgs turns the configured template into argv.
func buildStartArgs(cfg serverConfig, defaultJava string) []string {
	template := cfg.StartCommand
	if strings.TrimSpace(template) == "" {
		template = defaultStartCommand
	}
	java := cfg.JavaBin
	if java == "" {
		java = defaultJava
	}
	replacer := strings.NewReplacer("{java}", java, "{memory}", fmt.Sprint(cfg.MemoryMb), "{jar}", cfg.Jar,
		"{port}", fmt.Sprint(cfg.Port))
	fields := splitCommand(template)
	for i, f := range fields {
		fields[i] = replacer.Replace(f)
	}
	return fields
}

// usesJar reports whether the launch line references the configured JAR, so
// a custom script-based command does not require server.jar to exist.
func usesJar(cfg serverConfig) bool {
	return strings.TrimSpace(cfg.StartCommand) == "" || strings.Contains(cfg.StartCommand, "{jar}")
}

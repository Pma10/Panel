package main

import (
 "context"
 "embed"
 "errors"
 "fmt"
 "log"
 "net"
 "net/http"
 "net/url"
 "os"
 "os/signal"
 "path/filepath"
 "runtime"
 "strconv"
 "strings"
 "syscall"
 "time"
)

//go:embed index.html src
var frontend embed.FS

func envDefault(key, fallback string) string {
 if v := os.Getenv(key); v != "" { return v }
 return fallback
}

// Injected by release builds; development binaries report "dev".
var version = "dev"

func main() {
 if len(os.Args)>1 {
  switch os.Args[1] {
  case "--version","-version":
   fmt.Printf("Panel %s (%s/%s)\n",version,runtime.GOOS,runtime.GOARCH)
   return
  default:
   log.Fatalf("unknown option %q; supported: --version",os.Args[1])
  }
 }
 if err := run(); err != nil {
  log.Fatal(err)
 }
}

func run() error {
 port := envDefault("PANEL_PORT", "4173")
 if n, e := strconv.Atoi(port); e != nil || n < 1 || n > 65535 {
  return errors.New("PANEL_PORT must be an integer between 1 and 65535")
 }
 host := envDefault("PANEL_BIND_HOST", "127.0.0.1")
 origin := envDefault("PANEL_PUBLIC_ORIGIN", "http://127.0.0.1:"+port)
 parsed,err:=url.Parse(origin)
 if err!=nil||parsed.Host==""||parsed.User!=nil||parsed.RawQuery!=""||parsed.Fragment!=""||
  parsed.Path!=""||(parsed.Scheme!="http"&&parsed.Scheme!="https")||
  parsed.String()!=origin {
  return errors.New("PANEL_PUBLIC_ORIGIN must be scheme://host[:port], without path, query or credentials")
 }
 if host != "127.0.0.1" && host != "::1" && host != "localhost" && !strings.HasPrefix(origin, "https://") {
  return errors.New("public bind requires an HTTPS reverse proxy")
 }
 if password := os.Getenv("PANEL_ADMIN_PASSWORD"); password != "" && len(password) < 12 {
  return errors.New("PANEL_ADMIN_PASSWORD must be 12 or more characters (or unset it and create an account in the browser)")
 }
 root, err := filepath.Abs(envDefault("PANEL_DATA_DIR", ".panel-data"))
 if err != nil { return err }
 if err:=os.MkdirAll(root,0700);err!=nil{return err}
 release,err:=lockPanelData(root)
 if err!=nil{return err}
 defer release()
 manager, err := newManager(root, envDefault("PANEL_JAVA_BIN", "java"))
 if err != nil { return err }
 api, err := newPanelAPI(manager, origin, os.Getenv("PANEL_ADMIN_PASSWORD"))
 if err != nil { return err }
 if api.auth.setupRequired() {
  // Do not leave the first-account form open to the internet.
  // A reverse proxy (non-loopback origin) also makes it reachable from outside.
  loopback := (host == "127.0.0.1" || host == "::1" || host == "localhost") &&
   (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "::1" || parsed.Hostname() == "localhost")
  if !loopback {
   return errors.New("no accounts yet: set PANEL_ADMIN_PASSWORD once to create the admin account when the panel is reachable from other machines")
  }
  log.Printf("No accounts yet: open %s to create the first account", origin)
 }
 addr := net.JoinHostPort(host, port)
 srv := &http.Server{
  Addr: addr, Handler: api, ReadHeaderTimeout: 8*time.Second,
  IdleTimeout: 65*time.Second, MaxHeaderBytes: 16<<10,
 }
 listener, err := net.Listen("tcp", addr)
 if err != nil { return err }
 go manager.resumePending()
 log.Printf("Panel: %s (managed data: %s)", origin, root)
 // Serve may return as soon as Shutdown closes the listener. Do not let
 // main exit while the managed JVMs are still shutting down.
 stopCtx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
 defer stopSignals()
 shutdownComplete := make(chan struct{})
 go func() {
  defer close(shutdownComplete)
  <-stopCtx.Done()
  ctx, cancel := context.WithTimeout(context.Background(), 43*time.Second)
  defer cancel()
  api.closeStreams()
  if e := manager.shutdown(ctx); e != nil { log.Printf("Java 종료: %v", e) }
  if e := srv.Shutdown(ctx); e != nil { log.Printf("HTTP 종료: %v", e) }
 }()
 serveErr := srv.Serve(listener)
 // Also shut down the JVMs if HTTP Serve fails independently of SIGTERM.
 stopSignals()
 <-shutdownComplete
 if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
  return fmt.Errorf("server: %w", serveErr)
 }
 return nil
}

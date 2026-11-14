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
   fmt.Printf("pconn %s (%s/%s)\n",version,runtime.GOOS,runtime.GOARCH)
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
 if password := os.Getenv("PANEL_ADMIN_PASSWORD"); len(password) < 12 {
  return errors.New("set PANEL_ADMIN_PASSWORD (12 or more characters)")
 }
 root, err := filepath.Abs(envDefault("PANEL_DATA_DIR", ".panel-data"))
 if err != nil { return err }
 if err:=os.MkdirAll(root,0700);err!=nil{return err}
 release,err:=lockPanelData(root)
 if err!=nil{return err}
 defer release()
 manager, err := newManager(root, envDefault("PANEL_JAVA_BIN", "java"))
 if err != nil { return err }
 api := newPanelAPI(manager, origin, os.Getenv("PANEL_ADMIN_PASSWORD"))
 addr := net.JoinHostPort(host, port)
 srv := &http.Server{
  Addr: addr, Handler: api, ReadHeaderTimeout: 8*time.Second,
  IdleTimeout: 65*time.Second, MaxHeaderBytes: 16<<10,
 }
 listener, err := net.Listen("tcp", addr)
 if err != nil { return err }
 go manager.resumePending()
 log.Printf("피컨 Go 패널: %s (관리 서버: %s)", origin, root)
 done := make(chan os.Signal, 1)
 signal.Notify(done, os.Interrupt, syscall.SIGTERM)
 go func() {
  <-done
  ctx, cancel := context.WithTimeout(context.Background(), 43*time.Second)
  defer cancel()
  api.closeStreams()
  if e := manager.shutdown(ctx); e != nil { log.Printf("Java 종료: %v", e) }
  if e := srv.Shutdown(ctx); e != nil { log.Printf("HTTP 종료: %v", e) }
 }()
 if err = srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
  return fmt.Errorf("server: %w", err)
 }
 return nil
}

package main

import (
 "context"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "log"
 "mime"
 "net/http"
 "os"
 "path"
 "path/filepath"
 "strings"
 "sync"
 "time"
)

type panelAPI struct{
 manager *manager
 auth *authenticator
 origin string
 audit *auditLog
 closed chan struct{}
 closeOnce sync.Once
}
func newPanelAPI(m *manager, origin,password string)*panelAPI{
 return &panelAPI{manager:m,auth:newAuthenticator(password,origin),origin:origin,audit:newAudit(m.root),closed:make(chan struct{})}
}
func (a *panelAPI)closeStreams(){a.closeOnce.Do(func(){close(a.closed)})}
func jsonReply(w http.ResponseWriter,status int,value any){
 w.Header().Set("Content-Type","application/json; charset=utf-8")
 w.Header().Set("Cache-Control","no-store")
 w.WriteHeader(status)
 _=json.NewEncoder(w).Encode(value)
}
func apiFail(w http.ResponseWriter,err error){
 var api apiError
 if errors.As(err,&api){jsonReply(w,api.Status,map[string]string{"message":api.Message});return}
 if errors.Is(err,os.ErrNotExist){jsonReply(w,404,map[string]string{"message":"요청한 파일 또는 폴더가 없습니다."});return}
 if errors.Is(err,os.ErrExist){jsonReply(w,409,map[string]string{"message":"같은 이름의 파일 또는 폴더가 이미 존재합니다."});return}
 if errors.Is(err,os.ErrPermission){jsonReply(w,403,map[string]string{"message":"파일에 접근할 권한이 없습니다."});return}
 log.Printf("API error: %v",err)
 jsonReply(w,500,map[string]string{"message":"요청 처리 중 오류가 발생했습니다."})
}
func decodeBody(r *http.Request,target any)error{
 if !strings.HasPrefix(r.Header.Get("Content-Type"),"application/json"){return apiError{415,"JSON 요청만 허용합니다."}}
 data,err:=io.ReadAll(io.LimitReader(r.Body,65537))
 if err!=nil{return err}
 if len(data)>65536{return apiError{413,"요청 크기를 초과했습니다."}}
 if err:=json.Unmarshal(data,target);err!=nil{return apiError{400,"JSON 형식이 올바르지 않습니다."}}
 return nil
}
func assertMethod(r *http.Request,allowed string)error{
 if r.Method!=allowed{return apiError{405,"허용되지 않은 요청 방식입니다."}}
 return nil
}
func (a *panelAPI)ServeHTTP(w http.ResponseWriter,r *http.Request){
 h:=w.Header()
 h.Set("X-Content-Type-Options","nosniff")
 h.Set("Referrer-Policy","no-referrer")
 h.Set("X-Frame-Options","DENY")
 h.Set("Permissions-Policy","camera=(), microphone=(), geolocation=()")
 h.Set("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' https://cdn.jsdelivr.net; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
 if strings.HasPrefix(r.URL.Path,"/api/v1/"){
  if err:=a.route(w,r);err!=nil{apiFail(w,err)}
  return
 }
 if r.URL.Path=="/panel-config.js"{
  if r.Method!="GET"&&r.Method!="HEAD"{http.Error(w,"Method not allowed",405);return}
  h.Set("Content-Type","text/javascript; charset=utf-8")
  h.Set("Cache-Control","no-store")
  if r.Method=="GET"{io.WriteString(w,"window.PCONN_API_BASE = window.location.origin;")}
  return
 }
 if r.Method!="GET"&&r.Method!="HEAD"{http.Error(w,"Method not allowed",405);return}
 file:=r.URL.Path
 if file=="/"{file="/index.html"}
 if file!="/index.html" && !(strings.HasPrefix(file,"/src/") &&
  (strings.HasSuffix(file,".js")||strings.HasSuffix(file,".mjs")||strings.HasSuffix(file,".css"))){
  http.NotFound(w,r);return
 }
 if strings.Contains(file,"..") || strings.Contains(file,"\\") {http.NotFound(w,r);return}
 relative:=strings.TrimPrefix(file,"/")
 if path.Clean(relative)!=relative{http.NotFound(w,r);return}
 asset,err:=frontend.Open(relative)
 if err!=nil{http.NotFound(w,r);return}
 defer asset.Close()
 info,err:=asset.Stat()
 if err!=nil||!info.Mode().IsRegular(){http.NotFound(w,r);return}
 if file=="/index.html"{h.Set("Cache-Control","no-cache")}else{h.Set("Cache-Control","public, max-age=3600")}
 contentType:=mime.TypeByExtension(filepath.Ext(relative))
 if contentType==""{contentType="application/octet-stream"}
 h.Set("Content-Type",contentType)
 if seeker,ok:=asset.(io.ReadSeeker);ok{
  http.ServeContent(w,r,relative,time.Time{},seeker)
 }else{
  h.Set("Content-Length",fmt.Sprint(info.Size()))
  if r.Method=="GET"{_,_=io.Copy(w,asset)}
 }
}
func (a *panelAPI)route(w http.ResponseWriter,r *http.Request)error{
 url:=strings.TrimPrefix(r.URL.Path,"/api/v1/")
 parts:=strings.Split(url,"/")
 if url=="auth/login"{
  if err:=assertMethod(r,"POST");err!=nil{return err}
  var body struct{Password string `json:"password"`}
  if err:=decodeBody(r,&body);err!=nil{return err}
  token,csrf,err:=a.auth.login(r,body.Password);if err!=nil{return err}
  http.SetCookie(w,a.auth.cookie(token))
  jsonReply(w,200,map[string]any{"authenticated":true,"username":"관리자","csrf":csrf});return nil
 }
 token,session,err:=a.auth.session(r);if err!=nil{return err}
 if r.Method!="GET" && r.Method!="HEAD"{
  if err:=a.auth.requireMutation(r,session);err!=nil{return err}
 }
 if url=="auth/session"{
  if err:=assertMethod(r,"GET");err!=nil{return err}
  jsonReply(w,200,map[string]any{"authenticated":true,"username":"관리자","csrf":session.csrf});return nil
 }
 if url=="auth/logout"{
  if err:=assertMethod(r,"POST");err!=nil{return err}
  a.auth.logout(token)
  cookie:=a.auth.cookie("")
  cookie.MaxAge=-1
  http.SetCookie(w,cookie)
  jsonReply(w,200,map[string]bool{"loggedOut":true});return nil
 }
 if url=="audit"{
  if err:=assertMethod(r,"GET");err!=nil{return err}
  jsonReply(w,200,map[string]any{"entries":a.audit.read()});return nil
 }
 if url=="diagnostics"{
  if err:=assertMethod(r,"GET");err!=nil{return err}
  jsonReply(w,200,a.manager.diagnostics());return nil
 }
 if url=="templates"{
  if err:=assertMethod(r,"GET");err!=nil{return err}
  jsonReply(w,200,map[string]any{"templates":templateCatalogue()});return nil
 }
 if len(parts)==3 && parts[0]=="templates" && parts[2]=="versions"{
  if err:=assertMethod(r,"GET");err!=nil{return err}
  versions,err:=templateVersions(r.Context(),parts[1]);if err!=nil{return err}
  jsonReply(w,200,map[string]any{"project":parts[1],"versions":versions});return nil
 }
 if url=="servers"{
  switch r.Method{
  case "GET":jsonReply(w,200,map[string]any{"servers":a.manager.list()});return nil
  case "POST":
   var input serverConfig
   if err:=decodeBody(r,&input);err!=nil{return err}
   created,err:=a.manager.create(input);if err!=nil{return err}
   a.audit.append("POST /servers",fmt.Sprint(created["id"]))
   jsonReply(w,201,created);return nil
  default:return apiError{405,"허용하지 않은 방식입니다."}
  }
 }
 if len(parts)<2 || parts[0]!="servers" || len(parts[1])!=16 || !isHex(parts[1]){
  return apiError{404,"요청한 API를 찾을 수 없습니다."}
 }
 id:=parts[1]
 if _,err:=a.manager.summary(id);err!=nil{return err}
 rest:=strings.Join(parts[2:],"/")
 if rest==""{
  if err:=assertMethod(r,"GET");err!=nil{return err}
  value,err:=a.manager.summary(id);if err!=nil{return err};jsonReply(w,200,value);return nil
 }
 if rest=="health"{
  if err:=assertMethod(r,"GET");err!=nil{return err}
  value,err:=a.manager.summary(id);if err!=nil{return err}
  jsonReply(w,200,map[string]any{"id":id,"status":value["status"],"memoryGb":value["memoryGb"],"uptime":value["uptime"]});return nil
 }
 if rest=="network"{
  if err:=assertMethod(r,"GET");err!=nil{return err}
  config,err:=a.manager.startup(id);if err!=nil{return err}
  jsonReply(w,200,map[string]any{"ports":[]any{map[string]any{"port":config.Port,"protocol":"TCP","description":"Minecraft 접속","status":"allocated"}}});return nil
 }
 if rest=="startup"{
  if r.Method=="GET"{config,err:=a.manager.startup(id);if err!=nil{return err};jsonReply(w,200,config);return nil}
  if err:=assertMethod(r,"PATCH");err!=nil{return err}
  var values map[string]json.RawMessage
  if err:=decodeBody(r,&values);err!=nil{return err}
  result,err:=a.manager.update(id,values);if err!=nil{return err}
  a.audit.append("PATCH /startup",id);jsonReply(w,200,result);return nil
 }
 if rest=="logs"{
  if err:=assertMethod(r,"GET");err!=nil{return err}
  entries,err:=a.manager.history(id);if err!=nil{return err}
  jsonReply(w,200,map[string]any{"entries":entries});return nil
 }
 if rest=="logs/stream"{
  if err:=assertMethod(r,"GET");err!=nil{return err}
  return a.sse(w,r,id)
 }
 if rest=="commands"{
  if err:=assertMethod(r,"POST");err!=nil{return err}
  var body struct{Command string `json:"command"`}
  if err:=decodeBody(r,&body);err!=nil{return err}
  if err:=a.manager.command(id,body.Command);err!=nil{return err}
  a.audit.append("POST /commands",id)
  jsonReply(w,202,map[string]bool{"accepted":true});return nil
 }
 if strings.HasPrefix(rest,"actions/"){
  if err:=assertMethod(r,"POST");err!=nil{return err}
  action:=strings.TrimPrefix(rest,"actions/")
  var response any
  var err error
  switch action{
  case "start":response,err=a.manager.start(id)
  case "stop":err=a.manager.stop(id);response=map[string]bool{"accepted":true}
  case "restart":response,err=a.manager.restart(id)
  default:return apiError{400,"지원하지 않는 작업입니다."}
  }
  if err!=nil{return err}
  a.audit.append("POST /actions/"+action,id)
  jsonReply(w,202,response);return nil
 }
 if rest=="install"{
  if err:=assertMethod(r,"POST");err!=nil{return err}
  var data struct{Template string `json:"template"`; Version string `json:"version"`}
  if err:=decodeBody(r,&data);err!=nil{return err}
  result,err:=a.manager.installTemplate(r.Context(),id,data.Template,data.Version,false);if err!=nil{return err}
  a.audit.append("POST /install",id)
  jsonReply(w,201,result);return nil
 }
 if rest=="install/upgrade"{
  if err:=assertMethod(r,"POST");err!=nil{return err}
  var data struct{Template string `json:"template"`;Version string `json:"version"`}
  if err:=decodeBody(r,&data);err!=nil{return err}
  result,err:=a.manager.installTemplate(r.Context(),id,data.Template,data.Version,true)
  if err!=nil{return err}
  a.audit.append("POST /install/upgrade",id)
  jsonReply(w,201,result);return nil
 }
 if rest=="install/rollback"{
  if err:=assertMethod(r,"POST");err!=nil{return err}
  result,err:=a.manager.rollbackJar(id)
  if err!=nil{return err}
  a.audit.append("POST /install/rollback",id)
  jsonReply(w,200,result);return nil
 }
 if strings.HasPrefix(rest,"files") {
  return a.filesRoute(w,r,id,rest)
 }
 if rest=="backups"{
  if r.Method=="GET"{
   values,err:=a.manager.backups(id);if err!=nil{return err}
   jsonReply(w,200,map[string]any{"backups":values});return nil
  }
  if err:=assertMethod(r,"POST");err!=nil{return err}
  item,err:=a.manager.backup(r.Context(),id);if err!=nil{return err}
  a.audit.append("POST /backups",id);jsonReply(w,201,item);return nil
 }
 if len(parts)==4 && parts[2]=="backups"{
  if err:=assertMethod(r,"DELETE");err!=nil{return err}
  if err:=a.manager.deleteBackup(id,parts[3]);err!=nil{return err}
  a.audit.append("DELETE /backups",id)
  jsonReply(w,200,map[string]bool{"deleted":true});return nil
 }
 if len(parts)==5 && parts[2]=="backups" && parts[4]=="restore"{
  if err:=assertMethod(r,"POST");err!=nil{return err}
  result,err:=a.manager.restore(r.Context(),id,parts[3]);if err!=nil{return err}
  a.audit.append("POST /backups/restore",id);jsonReply(w,200,result);return nil
 }
 if rest=="schedules"{
  if r.Method=="GET"{list,err:=a.manager.schedules(id);if err!=nil{return err};jsonReply(w,200,map[string]any{"schedules":list});return nil}
  if err:=assertMethod(r,"POST");err!=nil{return err}
  var input schedule
  if err:=decodeBody(r,&input);err!=nil{return err}
  result,err:=a.manager.addSchedule(id,input);if err!=nil{return err}
  a.audit.append("POST /schedules",id);jsonReply(w,201,result);return nil
 }
 if len(parts)==4 && parts[2]=="schedules"{
  if err:=assertMethod(r,"DELETE");err!=nil{return err}
  if err:=a.manager.deleteSchedule(id,parts[3]);err!=nil{return err}
  a.audit.append("DELETE /schedules",id);jsonReply(w,200,map[string]bool{"deleted":true});return nil
 }
 return apiError{404,"API를 찾을 수 없습니다."}
}
// sseWriteTimeout bounds each network write independently; an idle healthy
// console can remain connected without a short global HTTP WriteTimeout.
const sseWriteTimeout = 5 * time.Second

func (a *panelAPI) sse(w http.ResponseWriter, r *http.Request, id string) error {
    token, session, err := a.auth.session(r)
    if err != nil { return err }
    if _, ok := w.(http.Flusher); !ok {
        return apiError{500, "스트리밍을 지원하지 않습니다."}
    }
    ch, release, err := a.manager.subscribe(id)
    if err != nil { return err }
    defer release()
    controller := http.NewResponseController(w)
    defer controller.SetWriteDeadline(time.Time{})
    writeFrame := func(frame string) error {
        // Recheck before writing, even when a queued log wins the select at
        // the same moment as expiry/revocation.
        select {
        case <-session.revoked: return context.Canceled
        default:
        }
        if !time.Now().Before(session.expires) { return context.DeadlineExceeded }
        deadline := time.Now().Add(sseWriteTimeout)
        if session.expires.Before(deadline) { deadline = session.expires }
        if err := controller.SetWriteDeadline(deadline); err != nil && !errors.Is(err, http.ErrNotSupported) {
            return err
        }
        if _, err := io.WriteString(w, frame); err != nil { return err }
        return controller.Flush()
    }
    w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
    w.Header().Set("Cache-Control", "no-cache, no-transform")
    w.Header().Set("X-Accel-Buffering", "no")
    if err := writeFrame(": connected\n\n"); err != nil { return nil }
    tick := time.NewTicker(20 * time.Second)
    defer tick.Stop()
    expiry := time.NewTimer(time.Until(session.expires))
    defer expiry.Stop()
    for {
        select {
        case <-r.Context().Done(): return nil
        case <-a.closed: return nil
        case <-session.revoked: return nil
        case <-expiry.C:
            a.auth.logout(token)
            return nil
        case entry, ok := <-ch:
            if !ok { return nil }
            raw, err := json.Marshal(entry)
            if err != nil { return nil }
            if err := writeFrame("data: " + string(raw) + "\n\n"); err != nil { return nil }
        case <-tick.C:
            if err := writeFrame(": ping\n\n"); err != nil { return nil }
        }
    }
}

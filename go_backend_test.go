package main

import (
 "bytes"
 "context"
 "encoding/json"
 "io"
 "net/http"
 "net/http/httptest"
 "os"
 "path/filepath"
 "strings"
 "testing"
 "time"
)

func testPanel(t *testing.T)(*manager,*httptest.Server){
 t.Helper()
 manager,err:=newManager(t.TempDir(),"java")
 if err!=nil{t.Fatal(err)}
 service:=newPanelAPI(manager,"http://127.0.0.1:1","integration-test-password-12345")
 server:=httptest.NewServer(service)
 service.auth.origin=server.URL
 service.origin=server.URL
 t.Cleanup(func(){
  server.Close()
  ctx,cancel:=context.WithTimeout(context.Background(),5*time.Second)
  defer cancel()
  if err:=manager.shutdown(ctx);err!=nil{t.Errorf("shutdown: %v",err)}
 })
 return manager,server
}
func req(t *testing.T,server *httptest.Server,method,path string,body []byte,cookie *http.Cookie,csrf string)*http.Response{
 t.Helper()
 request,err:=http.NewRequest(method,server.URL+path,bytes.NewReader(body))
 if err!=nil{t.Fatal(err)}
 if method!="GET"{
  request.Header.Set("Origin",server.URL)
  if body!=nil{request.Header.Set("Content-Type","application/json")}
 }
 if cookie!=nil{request.AddCookie(cookie)}
 if csrf!=""{request.Header.Set("X-CSRF-Token",csrf)}
 response,err:=http.DefaultClient.Do(request)
 if err!=nil{t.Fatal(err)}
 return response
}
func logIn(t *testing.T,server *httptest.Server)(*http.Cookie,string){
 t.Helper()
 response:=req(t,server,"POST","/api/v1/auth/login",[]byte(`{"password":"integration-test-password-12345"}`),nil,"")
 defer response.Body.Close()
 if response.StatusCode!=200{t.Fatalf("login code %d",response.StatusCode)}
 var body struct{CSRF string `json:"csrf"`}
 if err:=json.NewDecoder(response.Body).Decode(&body);err!=nil{t.Fatal(err)}
 if len(response.Cookies())==0||len(body.CSRF)!=64{t.Fatal("missing session cookie or CSRF")}
 return response.Cookies()[0],body.CSRF
}
func TestGoPanelLoginAndServerOperations(t *testing.T){
 manager,server:=testPanel(t)
 response:=req(t,server,"GET","/api/v1/servers",nil,nil,"")
 if response.StatusCode!=401{t.Fatalf("unauthorized status %d",response.StatusCode)}
 response.Body.Close()
 cookie,csrf:=logIn(t,server)
 response=req(t,server,"POST","/api/v1/servers",[]byte(`{"name":"Unauthorized","port":25601,"eulaAccepted":true}`),cookie,"")
 if response.StatusCode!=403{t.Fatalf("CSRF: %d",response.StatusCode)}
 response.Body.Close()
 response=req(t,server,"POST","/api/v1/servers",[]byte(`{"name":"Go Test Server","port":25601,"memoryMb":1024,"eulaAccepted":true}`),cookie,csrf)
 if response.StatusCode!=201{payload,_:=io.ReadAll(response.Body);t.Fatalf("create: %d %s",response.StatusCode,payload)}
 var created map[string]any
 if err:=json.NewDecoder(response.Body).Decode(&created);err!=nil{t.Fatal(err)}
 response.Body.Close()
 id:=created["id"].(string)
 if len(id)!=16{t.Fatal("invalid server ID")}
 response=req(t,server,"POST","/api/v1/servers/"+id+"/actions/start",[]byte(`{}`),cookie,csrf)
 if response.StatusCode!=409{t.Fatalf("starting without jar should be 409, got %d",response.StatusCode)}
 response.Body.Close()
 upload:=func(text string)int{
  request,_:=http.NewRequest("PUT",server.URL+"/api/v1/servers/"+id+"/files/upload?path=hello.txt",strings.NewReader(text))
  request.Header.Set("Origin",server.URL);request.Header.Set("X-CSRF-Token",csrf)
  request.Header.Set("Content-Type","application/octet-stream");request.AddCookie(cookie)
  response,err:=http.DefaultClient.Do(request)
  if err!=nil{t.Fatal(err)}
  defer response.Body.Close()
  return response.StatusCode
 }
 if upload("BEFORE")!=201{t.Fatal("file upload failed")}
 response=req(t,server,"POST","/api/v1/servers/"+id+"/backups",[]byte(`{}`),cookie,csrf)
 if response.StatusCode!=201{t.Fatalf("backup: %d",response.StatusCode)}
 var backup backupMeta
 if err:=json.NewDecoder(response.Body).Decode(&backup);err!=nil{t.Fatal(err)}
 response.Body.Close()
 if upload("AFTER")!=201{t.Fatal("file rewrite failed")}
 response=req(t,server,"POST","/api/v1/servers/"+id+"/backups/"+backup.ID+"/restore",[]byte(`{}`),cookie,csrf)
 if response.StatusCode!=200{t.Fatalf("restore: %d",response.StatusCode)}
 response.Body.Close()
 text,err:=manager.readText(id,"hello.txt")
 if err!=nil||text!="BEFORE"{t.Fatalf("restored file %q: %v",text,err)}
 response=req(t,server,"DELETE","/api/v1/servers/"+id+"/backups/"+backup.ID,nil,cookie,csrf)
 if response.StatusCode!=200{t.Fatalf("delete backup: %d",response.StatusCode)}
 response.Body.Close()
 remaining,err:=manager.backups(id)
 if err!=nil||len(remaining)!=0{t.Fatalf("backup deletion was not persisted: %d %v",len(remaining),err)}
 response=req(t,server,"GET","/api/v1/audit",nil,cookie,"")
 if response.StatusCode!=200{t.Fatalf("audit: %d",response.StatusCode)}
 response.Body.Close()
 response=req(t,server,"POST","/api/v1/auth/logout",[]byte(`{}`),cookie,csrf)
 if response.StatusCode!=200{t.Fatalf("logout %d",response.StatusCode)}
 response.Body.Close()
 response=req(t,server,"GET","/api/v1/servers",nil,cookie,"")
 if response.StatusCode!=401{t.Fatalf("session revoked status %d",response.StatusCode)}
 response.Body.Close()
}
func TestGoPathTraversalAndSymlinks(t *testing.T){
 for _,bad:=range []string{"../config.json","/etc/passwd","world/../config.json","world//data","C:\\Windows\\hosts"}{
  if _,err:=safeRelativePath(bad);err==nil{t.Errorf("accepted path %q",bad)}
 }
 manager,err:=newManager(t.TempDir(),"java")
 if err!=nil{t.Fatal(err)}
 defer manager.shutdown(context.Background())
 created,err:=manager.create(serverConfig{Name:"safe",Port:25602,EulaAccepted:true,MemoryMb:1024})
 if err!=nil{t.Fatal(err)}
 id:=created["id"].(string)
 outside:=t.TempDir()
 if err:=os.Symlink(outside,filepath.Join(manager.dir(id),"outside"));err==nil{
  if _,err:=manager.filePath(id,"outside/data.txt",true);err==nil{t.Fatal("symlink escape allowed")}
 }
}
func TestGoConsoleMemoryIsBounded(t *testing.T){
 manager,err:=newManager(t.TempDir(),"java")
 if err!=nil{t.Fatal(err)}
 defer manager.shutdown(context.Background())
 created,err:=manager.create(serverConfig{Name:"logs",Port:25603,EulaAccepted:true,MemoryMb:1024})
 if err!=nil{t.Fatal(err)}
 id:=created["id"].(string)
 for i:=0;i<10000;i++{manager.log(id,"INFO",strings.Repeat("A",2500))}
 items,err:=manager.history(id)
 if err!=nil{t.Fatal(err)}
 if len(items)>400{t.Fatalf("history size %d",len(items))}
 if len(items[0].Message)>2048{t.Fatalf("message length %d",len(items[0].Message))}
}
func TestGoStaticFrontendAndConfig(t *testing.T){
 _,server:=testPanel(t)
 for _,path:=range []string{"/","/src/app.js","/src/styles.css","/panel-config.js"}{
  response:=req(t,server,"GET",path,nil,nil,"")
  if response.StatusCode!=200{t.Errorf("static %s: %d",path,response.StatusCode)}
  response.Body.Close()
 }
 response:=req(t,server,"GET","/.panel-data/config.json",nil,nil,"")
 if response.StatusCode!=404{t.Errorf("secret path leaked: %d",response.StatusCode)}
 response.Body.Close()
}

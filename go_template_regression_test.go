package main

import (
 "bytes"
 "context"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "io"
 "net/http"
 "strconv"
 "strings"
 "testing"
)

type templateRoundTrip func(*http.Request) (*http.Response,error)
func (fn templateRoundTrip)RoundTrip(r *http.Request)(*http.Response,error){return fn(r)}

func jsonUpstream(status int,body []byte)*http.Response{
 return &http.Response{StatusCode:status,Header:make(http.Header),Body:io.NopCloser(bytes.NewReader(body))}
}

func TestPaperVersionsAreLimitedAfterNewestFirstSort(t *testing.T){
 versions:=map[string][]string{}
 for i:=0;i<160;i++{
  versions["group-"+strconv.Itoa(i)]=[]string{"1.21."+strconv.Itoa(i)}
 }
 response,_:=json.Marshal(map[string]any{"versions":versions})
 original:=officialClient
 officialClient=&http.Client{Transport:templateRoundTrip(func(r *http.Request)(*http.Response,error){
  if r.URL.Host!="fill.papermc.io"||r.URL.Path!="/v3/projects/paper"{
   t.Fatalf("unexpected API request: %s",r.URL.String())
  }
  return jsonUpstream(200,response),nil
 })}
 defer func(){officialClient=original}()
 result,err:=templateVersions(context.Background(),"paper")
 if err!=nil{t.Fatal(err)}
 if len(result)!=120{t.Fatalf("expected 120 versions, got %d",len(result))}
 if result[0]!="1.21.159"||result[len(result)-1]!="1.21.40"{
  t.Fatalf("newest-first selection was lost: first=%q last=%q",result[0],result[len(result)-1])
 }
}

func TestVerifiedOfficialPaperUpgradeAndJarRollback(t *testing.T){
 previous:=bytes.Repeat([]byte("old"),1000)
 newer:=bytes.Repeat([]byte("new"),1500)
 hashOf:=func(data []byte)string{sum:=sha256.Sum256(data);return hex.EncodeToString(sum[:])}
 buildResponse:=func(version string,data []byte)[]byte{
  sha:=hashOf(data)
  serverURL:="https://fill-data.papermc.io/v1/objects/"+sha+"/paper-"+version+".jar"
  builds:=[]map[string]any{
   {"id":2,"channel":"STABLE","downloads":map[string]any{
    "server:default":map[string]any{"url":serverURL,"size":len(data),"checksums":map[string]string{"sha256":sha}}}},
   {"id":9,"channel":"EXPERIMENTAL","downloads":map[string]any{
    "server:default":map[string]any{"url":serverURL,"size":len(data),"checksums":map[string]string{"sha256":sha}}}},
   {"id":7,"channel":"STABLE","downloads":map[string]any{
    "server:default":map[string]any{"url":serverURL,"size":len(data),"checksums":map[string]string{"sha256":sha}}}},
  }
  result,_:=json.Marshal(builds);return result
 }
 original:=officialClient
 officialClient=&http.Client{Transport:templateRoundTrip(func(r *http.Request)(*http.Response,error){
  if r.URL.Scheme!="https"{t.Fatalf("insecure request: %s",r.URL.String())}
  if r.URL.Host=="fill.papermc.io" && strings.Contains(r.URL.Path,"/builds"){
   if strings.Contains(r.URL.Path,"1.21.11"){return jsonUpstream(200,buildResponse("1.21.11",previous)),nil}
   return jsonUpstream(200,buildResponse("1.21.12",newer)),nil
  }
  if r.URL.Host=="fill-data.papermc.io"{
   if strings.Contains(r.URL.Path,hashOf(previous)){return jsonUpstream(200,previous),nil}
   if strings.Contains(r.URL.Path,hashOf(newer)){return jsonUpstream(200,newer),nil}
  }
  t.Fatalf("unexpected download request: %s",r.URL.String())
  return jsonUpstream(404,nil),nil
 })}
 defer func(){officialClient=original}()
 manager,err:=newManager(t.TempDir(),"java")
 if err!=nil{t.Fatal(err)}
 t.Cleanup(func(){_ = manager.shutdown(context.Background())})
 created,err:=manager.create(serverConfig{Name:"paper-template",Port:27414,MemoryMb:1024,EulaAccepted:true,Template:"paper"})
 if err!=nil{t.Fatal(err)}
 id:=created["id"].(string)
 install,err:=manager.installTemplate(context.Background(),id,"paper","1.21.11",false)
 if err!=nil{t.Fatal(err)}
 if install["buildId"]!=7{t.Fatalf("did not select newest stable build: %#v",install)}
 first,err:=manager.readText(id,"server.jar")
 if err!=nil||!bytes.Equal([]byte(first),previous){t.Fatalf("first JAR mismatch: %v",err)}
 _,err=manager.installTemplate(context.Background(),id,"paper","1.21.12",true)
 if err!=nil{t.Fatal(err)}
 cfg,err:=manager.startup(id)
 if err!=nil||cfg.InstalledVersion!="1.21.12"||cfg.RollbackVersion!="1.21.11"{
  t.Fatalf("version metadata mismatch after upgrade: %+v %v",cfg,err)
 }
 if _,err:=manager.rollbackJar(id);err!=nil{t.Fatal(err)}
 restored,err:=manager.readText(id,"server.jar")
 if err!=nil||!bytes.Equal([]byte(restored),previous){t.Fatalf("rollback did not restore original JAR: %v",err)}
}

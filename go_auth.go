package main

import (
 "crypto/rand"
 "crypto/sha256"
 "crypto/subtle"
 "encoding/hex"
 "net"
 "net/http"
 "strings"
 "sync"
 "time"
)

type apiError struct{ Status int; Message string }
func (e apiError)Error()string{return e.Message}

type authSession struct{ csrf string; expires time.Time }
type failureCount struct{ count int; expires time.Time }
type authenticator struct{
 mu sync.Mutex
 expected [32]byte
 origin string
 secure bool
 sessions map[string]authSession
 failures map[string]failureCount
}
func newAuthenticator(password,origin string)*authenticator{
 return &authenticator{
  expected:sha256.Sum256([]byte(password)),origin:origin,
  secure:strings.HasPrefix(origin,"https://"),
  sessions:map[string]authSession{},failures:map[string]failureCount{},
 }
}
func secureToken()string{
 b:=make([]byte,32)
 if _,err:=rand.Read(b);err!=nil{panic(err)}
 return hex.EncodeToString(b)
}
func clientIP(req *http.Request)string{
 host,_,err:=net.SplitHostPort(req.RemoteAddr);if err!=nil{return req.RemoteAddr}
 return host
}
func (a *authenticator)originAllowed(r *http.Request)bool{
 return r.Header.Get("Origin")==a.origin
}
func (a *authenticator)cookie(token string)*http.Cookie{
 return &http.Cookie{Name:"pconn_session",Value:token,Path:"/",HttpOnly:true,Secure:a.secure,
  SameSite:http.SameSiteStrictMode,MaxAge:8*3600}
}
func (a *authenticator)login(r *http.Request,password string)(string,string,error){
 if !a.originAllowed(r){return "","",apiError{403,"요청 출처가 일치하지 않습니다."}}
 if len(password)>4096{return "","",apiError{400,"비밀번호가 너무 깁니다."}}
 a.mu.Lock();defer a.mu.Unlock()
 now:=time.Now()
 for id,s:=range a.sessions{if now.After(s.expires){delete(a.sessions,id)}}
 for ip,f:=range a.failures{if now.After(f.expires){delete(a.failures,ip)}}
 ip:=clientIP(r);current:=a.failures[ip]
 if current.count>=8&&now.Before(current.expires){return "","",apiError{429,"로그인 시도가 너무 많습니다."}}
 hash:=sha256.Sum256([]byte(password))
 if subtle.ConstantTimeCompare(hash[:],a.expected[:])!=1{
  if now.After(current.expires){current=failureCount{}}
  current.count++;current.expires=now.Add(5*time.Minute);a.failures[ip]=current
  return "","",apiError{401,"비밀번호가 일치하지 않습니다."}
 }
 delete(a.failures,ip)
 if len(a.sessions)>=128{return "","",apiError{503,"관리자 세션 수가 너무 많습니다."}}
 token,csrf:=secureToken(),secureToken()
 a.sessions[token]=authSession{csrf:csrf,expires:now.Add(8*time.Hour)}
 return token,csrf,nil
}
func (a *authenticator)session(r *http.Request)(string,authSession,error){
 cookie,err:=r.Cookie("pconn_session")
 if err!=nil||len(cookie.Value)!=64{return "",authSession{},apiError{401,"로그인해야 합니다."}}
 a.mu.Lock();defer a.mu.Unlock()
 s,ok:=a.sessions[cookie.Value]
 if !ok||time.Now().After(s.expires){delete(a.sessions,cookie.Value);return "",authSession{},apiError{401,"세션이 만료됐습니다."}}
 return cookie.Value,s,nil
}
func (a *authenticator)requireMutation(r *http.Request,s authSession)error{
 if !a.originAllowed(r){return apiError{403,"허용하지 않은 출처입니다."}}
 given:=r.Header.Get("X-Csrf-Token")
 if len(given)!=len(s.csrf)||subtle.ConstantTimeCompare([]byte(given),[]byte(s.csrf))!=1{
  return apiError{403,"CSRF 검증에 실패했습니다."}
 }
 return nil
}
func (a *authenticator)logout(token string){
 a.mu.Lock();delete(a.sessions,token);a.mu.Unlock()
}

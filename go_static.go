package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// staticAsset is an embedded file prepared once: a content hash for
// If-None-Match revalidation and, for text assets, a gzip copy.
type staticAsset struct {
	etag string
	gz   []byte // nil when compression is not worthwhile
}

var staticAssets sync.Map // relative path -> *staticAsset

func preparedAsset(relative string) (*staticAsset, error) {
	if cached, ok := staticAssets.Load(relative); ok {
		return cached.(*staticAsset), nil
	}
	data, err := frontend.ReadFile(relative)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(data)
	asset := &staticAsset{etag: `"` + hex.EncodeToString(sum[:12]) + `"`}
	if len(data) > 1024 && (strings.HasSuffix(relative, ".js") || strings.HasSuffix(relative, ".mjs") ||
		strings.HasSuffix(relative, ".css") || strings.HasSuffix(relative, ".html")) {
		var buf bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		_, _ = zw.Write(data)
		if zw.Close() == nil && buf.Len() < len(data)*9/10 {
			asset.gz = buf.Bytes()
		}
	}
	actual, _ := staticAssets.LoadOrStore(relative, asset)
	return actual.(*staticAsset), nil
}

// serveEmbedded answers with 304 for unchanged files and gzip when accepted.
// Assets are still revalidated on every load (no-cache), so an upgrade is
// picked up immediately, but unchanged files cost a few hundred bytes.
func serveEmbedded(w http.ResponseWriter, r *http.Request, relative string) bool {
	asset, err := preparedAsset(relative)
	if err != nil {
		return false
	}
	h := w.Header()
	h.Add("Vary", "Accept-Encoding")
	if asset.gz != nil && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		h.Set("Content-Encoding", "gzip")
		h.Set("ETag", strings.TrimSuffix(asset.etag, `"`)+`-gz"`)
		http.ServeContent(w, r, relative, time.Time{}, bytes.NewReader(asset.gz))
		return true
	}
	// The embedded file is already a ReadSeeker over the binary; no copy.
	file, err := frontend.Open(relative)
	if err != nil {
		return false
	}
	defer file.Close()
	seeker, ok := file.(io.ReadSeeker)
	if !ok {
		return false
	}
	h.Set("ETag", asset.etag)
	http.ServeContent(w, r, relative, time.Time{}, seeker)
	return true
}

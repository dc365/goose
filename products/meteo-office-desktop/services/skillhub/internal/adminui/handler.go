package adminui

import (
	"embed"
	"net/http"
)

//go:embed static/*
var files embed.FS

func Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name, contentType, status := "static/not-found.html", "text/html; charset=utf-8", http.StatusNotFound
		switch r.URL.Path {
		case "/admin/":
			name, status = "static/index.html", http.StatusOK
		case "/admin/assets/admin.css":
			name, contentType, status = "static/admin.css", "text/css; charset=utf-8", http.StatusOK
		case "/admin/assets/admin.js":
			name, contentType, status = "static/admin.js", "text/javascript; charset=utf-8", http.StatusOK
		case "/admin/assets/favicon.svg", "/favicon.ico":
			name, contentType, status = "static/favicon.svg", "image/svg+xml", http.StatusOK
		}
		data, err := files.ReadFile(name)
		if err != nil {
			http.Error(w, "admin console asset unavailable", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.WriteHeader(status)
		_, _ = w.Write(data)
	})
}

package main

import (
	"os"
	"strings"
)

// loadDotEnv 读取简单的 KEY=VALUE 文件，只填充尚未存在的环境变量。
// 这样 `proxy.exe -static dist` 直接运行时也能读到 .env 里的 MUMBLE_TLS /
// RTC_PUBLIC_IP 等配置，与 docker compose 的行为一致；shell 里显式设置的
// 环境变量优先级更高，不会被文件覆盖。
//
// 支持：空行、# 注释、export 前缀、单/双引号包裹、CRLF。
func loadDotEnv(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	loaded := make([]string, 0, 8)
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		line = strings.TrimPrefix(line, "\ufeff") // Windows 编辑器可能写入 BOM
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		eq := strings.IndexByte(line, '=')
		if eq <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		if key == "" {
			continue
		}
		value := strings.TrimSpace(line[eq+1:])
		if len(value) >= 2 {
			first, last := value[0], value[len(value)-1]
			if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			continue
		}
		loaded = append(loaded, key)
	}
	return loaded, nil
}

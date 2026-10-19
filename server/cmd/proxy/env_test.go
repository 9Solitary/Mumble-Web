package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDotEnv(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	content := "\ufeff# comment\nFOO=bar\nexport QUOTED=\"a b c\"\nSINGLE='x=y'\nEMPTY=\nEXISTING=from-file\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EXISTING", "from-env")

	loaded, err := loadDotEnv(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv("FOO"); got != "bar" {
		t.Fatalf("FOO=%q", got)
	}
	if got := os.Getenv("QUOTED"); got != "a b c" {
		t.Fatalf("QUOTED=%q", got)
	}
	if got := os.Getenv("SINGLE"); got != "x=y" {
		t.Fatalf("SINGLE=%q", got)
	}
	if _, ok := os.LookupEnv("EMPTY"); !ok {
		t.Fatal("EMPTY 应被设置")
	}
	if got := os.Getenv("EXISTING"); got != "from-env" {
		t.Fatalf("已存在的环境变量不应被覆盖，得到 %q", got)
	}
	if len(loaded) == 0 {
		t.Fatal("loaded 应包含本次写入的 key")
	}
}

func TestLoadDotEnvMissing(t *testing.T) {
	if _, err := loadDotEnv(filepath.Join(t.TempDir(), "none.env")); err == nil {
		t.Fatal("缺失文件应返回 error")
	}
}

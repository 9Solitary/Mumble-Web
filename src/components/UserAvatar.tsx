// 以用户名哈希生成稳定配色的字母头像
// 色值定义在 tokens.css，这里只保存引用顺序。
const PALETTE = [
  "var(--avatar-1)", "var(--avatar-2)", "var(--avatar-3)", "var(--avatar-4)",
  "var(--avatar-5)", "var(--avatar-6)", "var(--avatar-7)", "var(--avatar-8)",
  "var(--avatar-9)", "var(--avatar-10)",
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function UserAvatar({
  name,
  size = 32,
  talking = false,
  muted = false,
}: {
  name: string;
  size?: number;
  talking?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-full flex items-center justify-center font-semibold text-fg shrink-0 transition-shadow ${
        talking ? "ring-2 ring-amber" : ""
      } ${muted ? "opacity-50" : ""}`}
      style={{
        width: size,
        height: size,
        backgroundColor: avatarColor(name),
        fontSize: size * 0.45,
      }}
    >
      {(name[0] ?? "?").toUpperCase()}
    </div>
  );
}

// 以用户名哈希生成稳定配色的字母头像
const PALETTE = [
  "#5865f2", "#57f287", "#fee75c", "#eb459e",
  "#ed4245", "#f47b3f", "#1abc9c", "#9b59b6",
  "#3498db", "#e91e63",
];

export function avatarColor(name: string): string {
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
      className={`rounded-full flex items-center justify-center font-semibold text-white shrink-0 transition-shadow ${
        talking ? "ring-2 ring-[#23a55a]" : ""
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

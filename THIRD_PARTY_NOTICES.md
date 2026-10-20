# 第三方组件与许可声明

本项目自身以 **MIT License** 发布，完整文本见根目录 [LICENSE](LICENSE)。

> 本项目是独立的第三方 Mumble Web 客户端，与 Mumble 项目无隶属或背书关系。
> “Mumble” 是 Mumble 项目的商标；本项目不使用 Mumble 官方图标。

## 一、随仓库分发的第三方代码

### gumble

- 位置：`server/internal/gumble/`
- 说明：Mumble 客户端协议库的 vendor 副本，包含本项目为 WebRTC 语音桥做的透传补丁。
- 许可证：**Mozilla Public License 2.0（MPL-2.0）**
- 许可全文：`server/internal/gumble/LICENSE`、[THIRD_PARTY_LICENSES/MPL-2.0.txt](THIRD_PARTY_LICENSES/MPL-2.0.txt)
- 上游：<https://github.com/layeh/gumble>
- 修改说明：见 `server/internal/gumble/README.md`。MPL 覆盖的文件仍按 MPL-2.0 发布，
  本项目自身的 MIT 许可证不改变这些文件的许可。

### Mumble 协议定义（MumbleProto）

- 位置：`server/internal/gumble/MumbleProto/`
- 说明：Mumble 协议 protobuf 定义与生成代码。
- 许可证：**BSD-3-Clause**
- 许可全文：`server/internal/gumble/MumbleProto/LICENSE`、[THIRD_PARTY_LICENSES/BSD-3-Clause.txt](THIRD_PARTY_LICENSES/BSD-3-Clause.txt)
- 上游：<https://github.com/mumble-voip/mumble>

## 二、构建时依赖

### 前端（npm）

`package.json` / `package-lock.json` 中列出的 npm 依赖各自保留其上游许可证。
构建产物中的第三方代码版权归对应依赖作者所有；主要依赖包括 React、Radix UI、
i18next、lucide-react、zustand、Vite 等。

### 代理（Go）

`server/go.mod` / `server/go.sum` 中列出的 Go 模块各自保留其上游许可证；
主要包括 Pion WebRTC/ICE、gorilla/websocket、golang/protobuf 等。

> 对外分发构建产物或容器镜像时，应同时保留本文件与 `THIRD_PARTY_LICENSES/`。
> 两个 Docker 镜像会把它们复制到镜像内的 `licenses/` / `/usr/share/nginx/html/licenses/`。

## 三、品牌资产

- 生产标志：`public/brand/mark-512.png`、`public/brand/mark-owl-*.png`、
  `public/favicon-*.png`、`public/favicon.ico`、`public/icon-*.png`、
  `public/apple-touch-icon.png`、`public/og-cover.png`
  为 M-OWL 品牌标志（墨底 + 薄荷猫头鹰，含负形 M 与耳麦）。
- `public/brand/mark.svg`、`public/favicon.svg`、`public/brand/mark-mono.svg`
  是 S 版描摹清理稿，标注为瑕疵版；仅归档，`mark-mono.svg` 例外用于 Safari pinned tab。
- 版权：Copyright (c) 2026 9.Solaris，随本项目以 MIT License 发布。
- “Mumble” 名称与 Mumble 官方标志归 Mumble 项目所有；本项目只以文字方式说明兼容性，
  不使用官方标志，也不暗示官方背书。

## 四、获取对应源码

- 本项目源码：<https://github.com/9Solitary/Mumble-Web>
- gumble 上游：<https://github.com/layeh/gumble>
- Mumble 上游：<https://github.com/mumble-voip/mumble>

如通过容器镜像部署，镜像内已包含本声明与第三方许可全文；对应源码可从上面的仓库获取。

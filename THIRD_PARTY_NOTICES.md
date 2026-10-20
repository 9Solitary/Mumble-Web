# 第三方组件声明

本项目包含以下第三方组件。各组件的版权与许可归其原作者所有。

## gumble

- 位置：`server/internal/gumble/`
- 说明：Mumble 客户端协议库的 vendor 副本，含本项目为 WebRTC 语音桥做的透传补丁。
- 许可证：Mozilla Public License 2.0（MPL-2.0）
- 上游：<https://github.com/layeh/gumble>

## Mumble 协议定义

- 位置：`server/internal/gumble/MumbleProto/`
- 说明：Mumble 协议 protobuf 定义与生成代码。
- 许可证：BSD-3-Clause；完整版权与许可文本见 `server/internal/gumble/MumbleProto/LICENSE`。
- 上游：<https://github.com/mumble-voip/mumble>

## 前端依赖

`package.json` / `package-lock.json` 中列出的 npm 依赖各自保留其上游许可证。
构建产物中的第三方代码版权归对应依赖作者所有。

## Go 依赖

`server/go.mod` / `server/go.sum` 中列出的 Go 模块各自保留其上游许可证。

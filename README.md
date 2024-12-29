# Arduino Panda

Arduino Panda 是一个用于 Arduino 开发的 VSCode 扩展，提供编译、上传等功能。

## 功能特点

- 🔧 编译 Arduino 程序
- 📤 上传程序到开发板
- 🚀 一键编译并上传
- 🔄 支持单文件/多文件编译模式
- 📊 实时显示编译/上传进度
- 🎯 自动检测串口和开发板

## 使用前提

1. 安装 [Arduino CLI](https://arduino.github.io/arduino-cli/latest/installation/)
2. 配置 Arduino CLI 路径

## 快速开始

1. 打开 VSCode 侧边栏的 Arduino Panda 图标
2. 在设置面板中配置：
   - Arduino CLI 路径
   - 选择开发板
   - 选择串口
3. 打开 .ino 文件，使用工具栏按钮：
   - ⚙️ 编译
   - ⬆️ 上传
   - ⚡ 编译并上传

## 配置选项

- `arduino-panda.cliPath`: Arduino CLI 可执行文件路径
- `arduino-panda.buildPath`: 编译输出目录
- `arduino-panda.board`: 开发板 FQBN
- `arduino-panda.port`: 串口
- `arduino-panda.compileMode`: 编译模式（单文件/多文件）

## 常见问题

1. 找不到 Arduino CLI
   - 确保正确安装 Arduino CLI
   - 检查 CLI 路径配置

2. 编译失败
   - 检查开发板选择是否正确
   - 查看输出面板的错误信息

3. 上传失败
   - 确认串口选择正确
   - 检查开发板连接状态

## 更新日志

### 0.0.1
- 初始版本发布
- 基本的编译和上传功能
- 支持单文件/多文件编译模式

## 贡献

欢迎提交 Issue 和 Pull Request 到 [GitHub 仓库](https://github.com/TomShaoquan/arduino-panda)

## 许可证

MIT

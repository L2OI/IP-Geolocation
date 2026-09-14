# IP Geolocation

<p align="center">
  <img src="./icon.png" width="96" height="96" alt="IP Geolocation icon">
</p>

一个简单的浏览器插件 可以通过指纹浏览器在线检测，避免语言，ip地址和代理地址不一致的情况，减少风风控，会对你的Chatgpt，Claude，Gemini生效

A simple Chromium browser extension that helps browser fingerprint checkers pass online consistency checks by keeping language, IP geolocation, proxy settings, timezone, and WebRTC behavior aligned.

目前版本已经改用CDP修改方案，伪装效果更好，无感过cloudflare，如有浏览器CDP弹窗请用tools内的关闭CDP提示工具，
或者手动添加--silent-debugger-extension-api浏览器启动参数

LINUXDO

## 黑白主题 / Theme

右上角纯圆形开关可切换亮色 / 暗色模式，页面与卡片使用统一背景：暗色背景为 `rgb(10, 10, 10)`，文字和实心按钮为 `rgb(250, 250, 250)`；亮色背景为 `rgb(255, 255, 255)`，文字和实心按钮为 `rgb(10, 10, 10)`。实心按钮内的文字使用对应背景色。默认识别并跟随系统主题；手动切换后记住选择，下次打开仍然生效。

Use the solid circular switch pinned to the top-right to toggle light/dark mode. Dark mode uses an RGB (10, 10, 10) background with RGB (250, 250, 250) text and filled buttons. Light mode uses an RGB (255, 255, 255) background with RGB (10, 10, 10) text and filled buttons. Filled button labels use the corresponding background color. The popup follows your system theme by default and remembers a manual selection across popup sessions.

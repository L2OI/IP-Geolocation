# IP Geolocation

<p align="center">
  <img src="./icon.png" width="96" height="96" alt="IP Geolocation icon">
</p>

一个简单的浏览器插件 可以通过指纹浏览器在线检测，避免语言，ip地址和代理地址不一致的情况，减少风控，会对你的Chatgpt，Claude，Gemini生效

A simple Chromium browser extension that helps browser fingerprint checkers pass online consistency checks by keeping language, IP geolocation, proxy settings, timezone, and WebRTC behavior aligned.

如有浏览器CDP弹窗请用tools内的关闭CDP提示工具，或者手动添加--silent-debugger-extension-api浏览器启动参数

**规则导入 / Rule imports**

在“隐藏范围 → 自定义规则 → 规则导入与订阅”中导入 GeoSite、GeoIP `.dat` 或域名文本，也可添加 HTTP/HTTPS 订阅。分类可填写 `google,openai`、`cn,private` 或 `google@ads`，留空导入全部。文本支持 `domain:`、`full:`、`keyword:`、`regexp:`、IP/CIDR 及常见 DOMAIN/IP-CIDR 列表；本地 `include:` 引用的文件需一起选择。订阅每天更新，失败时保留上次规则。

规则仅决定语言、时区和定位的隐藏范围。GeoIP 仅匹配网址中的 IP 地址；代理与 WebRTC 保持全局设置，受保护网站共用一套环境并应使用同一地区出口。

Import GeoSite/GeoIP `.dat` or domain text files under Hiding Scope → Custom Rules → Rule Imports & Subscriptions, or add an HTTP/HTTPS subscription. Select categories such as `google,openai`, `cn,private`, or `google@ads`; leave blank for all. Subscriptions update daily and retain cached rules on failure. Rules control language, timezone, and location hiding. GeoIP matches IP address URLs only. Proxy and WebRTC settings remain global; protected sites share one environment and should use exits in the same region.

LINUXDO
# StdOverwatch 课件阅读器

这是独立版课件阅读器。整个文件夹可单独复制使用。打开后导入自己的课件即可开始。

```powershell
node serve.mjs
```

需要 Node.js 22.7 或更新版本。默认地址为 [http://127.0.0.1:4174/](http://127.0.0.1:4174/)。

- 批量导入 PPTX、PDF、HTML 或课件文件夹，并支持 Paper-Master 的 `slides-manifest.json`。旧版 `.ppt` 请先另存为 PPTX 或 PDF。
- 在课件页旁选页提问、记笔记和标记重点。在复习工作台指定范围和复习要求，生成可回到原页的大纲、讲义及自测题，或导出 Markdown。
- 文件和学习记录存储在当前浏览器的当前站点。独立版的本地地址和线上地址分别有自己的课件库。
- 使用 AI 时，在阅读页的「AI 设置」中填入本次会话的 DeepSeek API Key。自托管也可以设置服务端环境变量 `DEEPSEEK_API_KEY`。每次请求只提交所用的课件摘录和相关学习记录。

浏览器渲染使用 [pptx-renderer](https://github.com/aiden0z/pptx-renderer) 和 [PDF.js](https://github.com/mozilla/pdf.js)。PDF.js 使用 6.5.438 的 `legacy/build`，更新时请一起替换主模块和 worker。相关许可证随 `dist/client/vendor` 分发。

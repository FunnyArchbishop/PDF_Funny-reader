# StdOverwatch 课件阅读器

这是独立版课件阅读器。整个文件夹可单独复制使用。打开后导入自己的课件即可开始。

```powershell
node serve.mjs
```

需要 Node.js 22.7 或更新版本。默认地址为 [http://127.0.0.1:4174/](http://127.0.0.1:4174/)。

- 批量导入 PPTX、PDF、HTML 或课件文件夹，并支持 Paper-Master 的 `slides-manifest.json`。旧版 `.ppt` 请先另存为 PPTX 或 PDF。
- 用「新建课表」为每门课建立独立课件库，用「保存课表」设置名称。课件、阅读进度、问答、笔记和复习材料按课表自动保存，已有内容在「默认课表」中。
- 在课件页旁选页提问、记笔记和标记重点。在复习工作台指定范围和复习要求，生成可回到原页的大纲、讲义及自测题，或导出 Markdown。
- 文件和学习记录存储在当前浏览器的当前站点。独立版的本地地址和线上地址分别有自己的课件库。
- 使用 AI 时，在阅读页的「AI 设置」中填入本次会话的 DeepSeek API Key。自托管也可以设置服务端环境变量 `DEEPSEEK_API_KEY`。每次请求只提交所用的课件摘录和相关学习记录。

浏览器渲染使用 [pptx-renderer](https://github.com/aiden0z/pptx-renderer) 和 [PDF.js](https://github.com/mozilla/pdf.js)。PDF.js 使用 6.5.438 的 `legacy/build`，更新时请一起替换主模块和 worker。相关许可证随 `dist/client/vendor` 分发。

## PDF 公式与翻译

打开 PDF 后，点击「PDF 工具」。公式或符号缺失时，先用「字体兼容模式」重新绘制字形，或在浏览器的 PDF 阅读器中对照原件。原件没有的内容需要重新取得原始文档或从源稿导出。

修复和翻译通过各自的服务完成。把下面的地址替换成你部署的实例，再从同一个 PowerShell 窗口启动阅读器。两项可以分别配置。

```powershell
$env:STIRLING_PDF_URL = 'http://127.0.0.1:8080'
$env:PDFMATH_TRANSLATE_URL = 'http://127.0.0.1:11008'
node serve.mjs
```

- Stirling‑PDF 使用自托管服务的 `/api/v1/misc/repair`。如果实例要求 API 密钥，配置 `STIRLING_PDF_KEY`。修复结果另存并加入课件库。[Stirling‑PDF API](https://docs.stirlingpdf.com/Developers/API/)
- PDFMathTranslate 使用 `pdf2zh[backend]` 的 HTTP 服务，需同时启动其 Flask、Celery 和 Redis。翻译引擎通过 `PDFMATH_TRANSLATE_SERVICE` 设置，默认 `google`。若反向代理要求 Bearer 认证，可配置 `PDFMATH_TRANSLATE_TOKEN`。处理完成后可分别加入双语版和译文版，公式保留效果取决于原件和翻译引擎。[PDFMathTranslate HTTP API](https://github.com/PDFMathTranslate/PDFMathTranslate/blob/main/docs/APIS.md)
- 若部署在 Sites，把服务地址设置为该站点可访问的 HTTPS 地址，并在服务端配置对应环境变量。处理入口一次最多接收 20 MB 的 PDF，点击修复或翻译才会向对应服务提交文档。

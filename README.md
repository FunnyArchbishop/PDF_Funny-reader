# StdOverwatch 课件阅读器

这是独立版课件阅读器。整个文件夹可单独复制使用。打开后导入自己的课件即可开始。

[GitHub 网页版](https://funnyarchbishop.github.io/PDF_Funny-reader/) 是统一入口。课表、课件和笔记保存在当前浏览器。连接后端后，可在同一页使用 AI 问答、复习生成、PDF 修复和翻译。

```powershell
node serve.mjs
```

需要 Node.js 22.7 或更新版本。默认地址为 [http://127.0.0.1:4174/](http://127.0.0.1:4174/)。

在 GitHub 网页版打开「设置 → 后端连接」，输入上面命令打印的地址和配对码。浏览器如提示访问本地网络，请允许。配对只在当前标签页有效，服务重启会生成新配对码。直接打开本地阅读器地址时使用同源 API，无需配对。

界面和 API 分开实现。桌面外壳可直接调用 `startReaderHost({port: 0, webOrigins: []})`，从返回的 `origin` 加载同一套界面，关闭时调用返回的 `close()`。本地服务只监听回环地址，桌面模式无需允许跨站访问。GitHub 网页版与本地应用是不同浏览器来源，分别保存课件库。

- 批量导入 PowerPoint 97–2003（PPT）、PPTX、PDF、HTML 或课件文件夹，并支持 Paper-Master 的 `slides-manifest.json`。旧版 PPT 以静态幻灯片预览，支持翻页、提取文字和复习。密码保护的 PPT 需先解密。
- 用「新建课表」为每门课建立独立课件库，用「保存课表」设置名称。课件、阅读进度、问答、笔记和复习材料按课表自动保存，已有内容在「默认课表」中。
- 在课件页旁选页提问、记笔记和标记重点。在复习工作台指定范围和复习要求，生成可回到原页的大纲、讲义及自测题，或导出 Markdown。
- 文件和学习记录存储在当前浏览器的当前站点。独立版的本地地址和线上地址分别有自己的课件库。
- 右上角的「设置」可以更改主题、填写课件清单基址和本次会话的 DeepSeek API Key。也可在启动后端前设置环境变量 `DEEPSEEK_API_KEY`。每次请求只提交所用的课件摘录和相关学习记录。

浏览器渲染使用 [pptx-renderer](https://github.com/aiden0z/pptx-renderer) 和 [PDF.js](https://github.com/mozilla/pdf.js)。PPTX 内嵌的 WMF 图片通过 [emf-converter](https://github.com/ChristopherVR/emf-converter) 4.29.0 在浏览器后台转换。PDF.js 使用 6.5.438 的 `legacy/build`，更新时请一起替换主模块和 worker。相关许可证随 `dist/client/vendor` 分发。

旧版 PPT 使用 [Web-PPT](https://github.com/unStone/web-ppt) 的 `@web-ppt/core@0.8.0` 和 `fflate@0.8.2`。`dist/client/vendor/legacy-ppt/core.mjs` 是这两个依赖在浏览器端的 ESM bundle，入口从 `@web-ppt/core` 重新导出 `parse`、`PasswordRequiredError`、`slideText` 和 `slideToSvgFile`，用 esbuild 以 `--bundle --platform=browser --format=esm --minify --legal-comments=eof` 构建。

旧版 PPT 解析器有一处本地修正。更新 Web-PPT 时需保留字符格式掩码 0x00800000 对应的 symbolFontIdx，并在构造文本 run 时按当前或继承的符号字体调用 symbol.mjs 的 decodeSymbolText。映射来源和许可随 ADOBE-SYMBOL.txt 分发。

## PDF 公式与翻译

公式或符号缺失时，打开「设置」中的「字体兼容模式」，或从「PDF 工具」打开原件对照。原件没有的内容需要重新取得原始文档或从源稿导出。

修复和翻译通过各自的服务完成。把下面的地址替换成你部署的实例，再从同一个 PowerShell 窗口启动阅读器。两项可以分别配置。

```powershell
$env:STIRLING_PDF_URL = 'http://127.0.0.1:8080'
$env:PDFMATH_TRANSLATE_URL = 'http://127.0.0.1:11008'
node serve.mjs
```

- Stirling‑PDF 使用自托管服务的 `/api/v1/misc/repair`。如果实例要求 API 密钥，配置 `STIRLING_PDF_KEY`。修复结果另存并加入课件库。[Stirling‑PDF API](https://docs.stirlingpdf.com/Developers/API/)
- PDFMathTranslate 使用 `pdf2zh[backend]` 的 HTTP 服务，需同时启动其 Flask、Celery 和 Redis。翻译引擎通过 `PDFMATH_TRANSLATE_SERVICE` 设置，默认 `google`。若反向代理要求 Bearer 认证，可配置 `PDFMATH_TRANSLATE_TOKEN`。处理完成后可分别加入双语版和译文版，公式保留效果取决于原件和翻译引擎。[PDFMathTranslate HTTP API](https://github.com/PDFMathTranslate/PDFMathTranslate/blob/main/docs/APIS.md)
- 若部署在 Sites，把服务地址设置为该站点可访问的 HTTPS 地址，并在服务端配置对应环境变量。处理入口一次最多接收 20 MB 的 PDF，点击修复或翻译才会向对应服务提交文档。

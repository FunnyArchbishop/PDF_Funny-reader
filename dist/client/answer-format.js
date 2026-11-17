"use strict";

(() => {
  const parser = new marked.Marked();
  const displayMath = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n|$)/;
  const inlineMath = /^(?:\\\(([^\n]+?)\\\)|\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<!\s)\$(?![$\d]))/;

  function mathHtml({literal, expression, display}) {
    try {
      const math = katex.renderToString(expression, {
        displayMode: display, output: "mathml", trust: false, maxExpand: 200, maxSize: 20,
      });
      return display ? `<div class="answer-math-display">${math}</div>\n` : math;
    } catch {
      const fallback = document.createElement("code");
      fallback.textContent = literal;
      return fallback.outerHTML;
    }
  }

  parser.use({
    gfm: true,
    renderer: {
      html({text}) {
        const escaped = document.createElement("span");
        escaped.textContent = text;
        return escaped.innerHTML;
      },
      image({text}) {
        const alternative = document.createElement("span");
        alternative.textContent = text ? `[图片：${text}]` : "[图片]";
        return alternative.outerHTML;
      },
    },
    extensions: [
      {
        name: "courseDisplayMath",
        level: "block",
        start(source) {
          const match = /(?:^|\n)(?=\$\$|\\\[)/.exec(source);
          return match ? match.index + match[0].length : undefined;
        },
        tokenizer(source) {
          const match = displayMath.exec(source);
          if (!match) return;
          const expression = (match[1] ?? match[2]).trim();
          return {type: "courseDisplayMath", raw: match[0], literal: match[0].trim(), expression, display: true};
        },
        renderer: mathHtml,
      },
      {
        name: "courseInlineMath",
        level: "inline",
        start(source) {
          const index = source.search(/\\\(|\$/);
          return index < 0 ? undefined : index;
        },
        tokenizer(source) {
          const match = inlineMath.exec(source);
          if (match) return {type: "courseInlineMath", raw: match[0], literal: match[0], expression: match[1] ?? match[2], display: false};
        },
        renderer: mathHtml,
      },
    ],
  });

  window.renderCourseAnswer = (text, target) => {
    try {
      const content = DOMPurify.sanitize(parser.parse(text), {
        RETURN_DOM_FRAGMENT: true,
        USE_PROFILES: {html: true, mathMl: true},
        FORBID_TAGS: ["img", "iframe", "form", "style", "audio", "video"],
      });
      for (const link of content.querySelectorAll("a[href]")) {
        const url = new URL(link.getAttribute("href"), location.href);
        if (url.protocol === "https:" || url.protocol === "http:") {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        } else {
          link.removeAttribute("href");
        }
      }
      for (const table of content.querySelectorAll("table")) {
        const wrapper = document.createElement("div");
        wrapper.className = "answer-table-scroll";
        table.replaceWith(wrapper);
        wrapper.append(table);
      }
      target.replaceChildren(content);
    } catch {
      target.textContent = text;
    }
  };
})();

(function initCheeseSearchQuery(global) {
  function normalizeText(value) {
    return String(value || "")
      .toLocaleLowerCase("ko-KR")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getSearchParts(video, options = {}) {
    const fields = Array.isArray(options.fields) && options.fields.length
      ? options.fields.map((field) =>
          typeof field === "function" ? field(video) : video?.[field]
        )
      : [
          video?.videoTitle,
          video?.videoCategory,
          video?.videoCategoryValue,
          ...(Array.isArray(video?.tags) ? video.tags : [])
        ];
    const tags = options.useTags === false
      ? []
      : (Array.isArray(video?.tags) ? video.tags : []).map(normalizeText);
    const categoryFields = Array.isArray(options.categoryFields) && options.categoryFields.length
      ? options.categoryFields.map((field) =>
          typeof field === "function" ? field(video) : video?.[field]
        )
      : [
          video?.videoCategory,
          video?.videoCategoryValue,
          video?.clipCategory,
          video?.clipCategoryValue,
          video?.categoryValue
        ];

    return {
      text: normalizeText(fields.filter(Boolean).join(" ")),
      tags,
      categories: categoryFields.filter(Boolean).map(normalizeText)
    };
  }

  function tokenize(input) {
    const tokens = [];
    const source = String(input || "");
    let index = 0;

    while (index < source.length) {
      const char = source[index];
      if (/\s/.test(char)) {
        index += 1;
        continue;
      }

      if (char === "(") {
        tokens.push({ type: "LPAREN" });
        index += 1;
        continue;
      }

      if (char === ")") {
        tokens.push({ type: "RPAREN" });
        index += 1;
        continue;
      }

      if (char === "|") {
        tokens.push({ type: "OR" });
        index += 1;
        continue;
      }

      if (char === "-") {
        tokens.push({ type: "NOT" });
        index += 1;
        continue;
      }

      const parsed = readTerm(source, index);
      index = parsed.nextIndex;
      const value = parsed.value;
      const upper = value.toLocaleUpperCase("en-US");
      if (upper === "OR") {
        tokens.push({ type: "OR" });
      } else if (upper === "AND") {
        tokens.push({ type: "AND" });
      } else if (value) {
        tokens.push({ type: "TERM", value });
      }
    }

    return tokens;
  }

  function readTerm(source, startIndex) {
    let index = startIndex;
    let prefix = "";

    if (source[index] === "#" || source[index] === "@") {
      prefix = "#";
      if (source[index] === "@") prefix = "@";
      index += 1;
    }

    const fieldPrefix = readFieldPrefix(source, index);
    if (!prefix && fieldPrefix && (source[fieldPrefix.nextIndex] === '"' || source[fieldPrefix.nextIndex] === "'")) {
      index = fieldPrefix.nextIndex;
      prefix = `${fieldPrefix.value}:`;
    }

    if (source[index] === '"' || source[index] === "'") {
      const quote = source[index];
      index += 1;
      const start = index;
      while (index < source.length && source[index] !== quote) {
        index += 1;
      }
      const value = source.slice(start, index);
      if (source[index] === quote) index += 1;
      return { value: `${prefix}${value}`, nextIndex: index };
    }

    const start = index;
    while (index < source.length && !/[\s()|]/.test(source[index])) {
      index += 1;
    }
    return { value: `${prefix}${source.slice(start, index)}`, nextIndex: index };
  }

  function readFieldPrefix(source, index) {
    const match = source.slice(index).match(/^([A-Za-z가-힣_]+):/);
    if (!match) return null;
    return {
      value: match[1],
      nextIndex: index + match[0].length
    };
  }

  function parseQuery(input) {
    const tokens = tokenize(input);
    let index = 0;

    function peek() {
      return tokens[index] || null;
    }

    function consume(type) {
      if (peek()?.type !== type) return null;
      index += 1;
      return tokens[index - 1];
    }

    function startsExpression(token) {
      return token && ["TERM", "NOT", "LPAREN"].includes(token.type);
    }

    function parseExpression() {
      return parseOr();
    }

    function parseOr() {
      let node = parseAnd();
      while (consume("OR")) {
        const right = parseAnd();
        if (!right) break;
        node = node ? { type: "OR", left: node, right } : right;
      }
      return node;
    }

    function parseAnd() {
      let node = parseNot();
      while (true) {
        if (consume("AND")) {
          const right = parseNot();
          if (!right) break;
          node = node ? { type: "AND", left: node, right } : right;
          continue;
        }

        if (!startsExpression(peek())) break;
        const right = parseNot();
        if (!right) break;
        node = node ? { type: "AND", left: node, right } : right;
      }
      return node;
    }

    function parseNot() {
      if (consume("NOT")) {
        const child = parseNot();
        return child ? { type: "NOT", child } : null;
      }
      return parsePrimary();
    }

    function parsePrimary() {
      const term = consume("TERM");
      if (term) return { type: "TERM", value: term.value };

      if (consume("LPAREN")) {
        const node = parseExpression();
        consume("RPAREN");
        return node;
      }

      return null;
    }

    return parseExpression();
  }

  function matchesTerm(value, parts, options = {}) {
    const isTagQuery = options.useTags !== false && value.startsWith("#");
    const categoryQuery = getCategoryQuery(value);
    const term = normalizeText(
      isTagQuery ? value.slice(1) : categoryQuery !== null ? categoryQuery : value
    );
    if (!term) return true;

    if (isTagQuery) {
      return parts.tags.some((tag) => tag.includes(term));
    }

    if (categoryQuery !== null) {
      return parts.categories.some((category) => category.includes(term));
    }

    return parts.text.includes(term);
  }

  function getCategoryQuery(value) {
    if (value.startsWith("@")) return value.slice(1);
    const separatorIndex = value.indexOf(":");
    if (separatorIndex < 0) return null;
    const prefix = normalizeText(value.slice(0, separatorIndex));
    if (prefix === "category" || prefix === "cat" || prefix === "카테고리") {
      return value.slice(separatorIndex + 1);
    }
    return null;
  }

  function evaluate(node, parts, options = {}) {
    if (!node) return true;
    if (node.type === "TERM") return matchesTerm(node.value, parts, options);
    if (node.type === "NOT") return !evaluate(node.child, parts, options);
    if (node.type === "AND") return evaluate(node.left, parts, options) && evaluate(node.right, parts, options);
    if (node.type === "OR") return evaluate(node.left, parts, options) || evaluate(node.right, parts, options);
    return true;
  }

  function matches(video, query, options = {}) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return true;
    return evaluate(parseQuery(query), getSearchParts(video, options), options);
  }

  function buildCategoryTerm(category) {
    const value = String(category || "").trim().replace(/"/g, "'");
    if (!value) return "";
    return `@"${value}"`;
  }

  function withCategoryFilter(query, category) {
    const categoryTerm = buildCategoryTerm(category);
    if (!categoryTerm) return String(query || "").trim();
    const baseQuery = String(query || "")
      .replace(
        /(^|\s)(?:@(?:"[^"]*"|'[^']*'|[^\s()|]+)|(?:category|cat|카테고리):(?:"[^"]*"|'[^']*'|[^\s()|]+))/gi,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();
    return [baseQuery, categoryTerm].filter(Boolean).join(" ");
  }

  global.CheeseSearchQuery = {
    buildCategoryTerm,
    matches,
    normalizeText,
    withCategoryFilter
  };
})(globalThis);

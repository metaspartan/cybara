import Foundation

private let inboundContextHeaders = [
    "Conversation info (untrusted metadata):",
    "Sender (untrusted metadata):",
    "Thread starter (untrusted, for context):",
    "Replied message (untrusted, for context):",
    "Forwarded message context (untrusted metadata):",
    "Chat history since last reply (untrusted, for context):",
]

struct NativeMarkdownBlock: Identifiable, Equatable {
    enum Kind: Equatable {
        case paragraph(String)
        case heading(level: Int, text: String)
        case unorderedList([String])
        case orderedList([String])
        case code(language: String, code: String, isDiff: Bool)
        case blockquote(String)
        case table([[String]])
        case image(alt: String, source: String)
        case horizontalRule
    }

    let id: Int
    let kind: Kind
}

struct NativeAssistantMarkupResult: Equatable {
    let content: String
    let thinking: String
}

enum NativeMarkdown {
    private static let reasoningTagNamePattern =
        #"REASONING_SCRATCHPAD|antthinking|(?:antml:|mm:)?(?:thinking|think|thought)|reasoning"#

    static func preprocess(_ raw: String, stripAssistantMarkup: Bool = true) -> String {
        let visibleContent = stripAssistantMarkup ? stripAssistantMarkupTags(raw).content : raw
        return collapseBlankLines(stripInboundContextBlocks(stripPrefixedTimestamps(visibleContent)))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func parse(_ raw: String, stripAssistantMarkup: Bool = true) -> [NativeMarkdownBlock] {
        let normalized = preprocess(raw, stripAssistantMarkup: stripAssistantMarkup)
        guard !normalized.isEmpty else { return [] }

        let lines = normalized.components(separatedBy: "\n")
        var blocks: [NativeMarkdownBlock] = []
        var index = 0
        var blockID = 0

        func append(_ kind: NativeMarkdownBlock.Kind) {
            blocks.append(NativeMarkdownBlock(id: blockID, kind: kind))
            blockID += 1
        }

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.isEmpty {
                index += 1
                continue
            }

            if trimmed.hasPrefix("```") {
                let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                index += 1
                var codeLines: [String] = []
                while index < lines.count {
                    let codeLine = lines[index]
                    if codeLine.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                        index += 1
                        break
                    }
                    codeLines.append(codeLine)
                    index += 1
                }
                let code = codeLines.joined(separator: "\n")
                let normalizedLanguage = normalizeCodeLanguage(language)
                append(.code(
                    language: normalizedLanguage,
                    code: code,
                    isDiff: looksLikeDiff(code: code, language: normalizedLanguage)
                ))
                continue
            }

            if isHorizontalRule(trimmed) {
                append(.horizontalRule)
                index += 1
                continue
            }

            if let heading = parseHeading(trimmed) {
                append(.heading(level: heading.level, text: heading.text))
                index += 1
                continue
            }

            if let image = parseImage(trimmed) {
                append(.image(alt: image.alt, source: image.source))
                index += 1
                continue
            }

            if isTableStart(lines, at: index) {
                var rows: [[String]] = []
                rows.append(parseTableRow(lines[index]))
                index += 2
                while index < lines.count, lines[index].contains("|") {
                    let row = parseTableRow(lines[index])
                    if row.isEmpty { break }
                    rows.append(row)
                    index += 1
                }
                append(.table(rows))
                continue
            }

            if let first = parseUnorderedItem(trimmed) {
                var items = [first]
                index += 1
                while index < lines.count,
                    let next = parseUnorderedItem(lines[index].trimmingCharacters(in: .whitespaces))
                {
                    items.append(next)
                    index += 1
                }
                append(.unorderedList(items))
                continue
            }

            if let first = parseOrderedItem(trimmed) {
                var items = [first]
                index += 1
                while index < lines.count,
                    let next = parseOrderedItem(lines[index].trimmingCharacters(in: .whitespaces))
                {
                    items.append(next)
                    index += 1
                }
                append(.orderedList(items))
                continue
            }

            if trimmed.hasPrefix(">") {
                var quoted: [String] = []
                while index < lines.count {
                    let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                    guard candidate.hasPrefix(">") else { break }
                    quoted.append(String(candidate.dropFirst()).trimmingCharacters(in: .whitespaces))
                    index += 1
                }
                append(.blockquote(quoted.joined(separator: "\n")))
                continue
            }

            var paragraph = [line]
            index += 1
            while index < lines.count {
                let next = lines[index]
                let nextTrimmed = next.trimmingCharacters(in: .whitespaces)
                if nextTrimmed.isEmpty || startsBlock(nextTrimmed, lines: lines, index: index) { break }
                paragraph.append(next)
                index += 1
            }
            append(.paragraph(paragraph.joined(separator: "\n")))
        }

        return blocks
    }

    static func stripAssistantMarkupTags(_ raw: String) -> NativeAssistantMarkupResult {
        var working = raw
        var thinking: [String] = []

        for (pattern, captureIndex) in [
            (#"<(\#(reasoningTagNamePattern))\b[^>]*>([\s\S]*?)</\1>"#, 2),
            (#"\[(?:thinking|reasoning)\]([\s\S]*?)\[/(?:thinking|reasoning)\]"#, 1),
        ] {
            let matches = regexMatches(pattern, in: working)
            for match in matches {
                let captured = match.count > captureIndex
                    ? match[captureIndex].trimmingCharacters(in: .whitespacesAndNewlines)
                    : ""
                if !captured.isEmpty {
                    thinking.append(captured)
                }
            }
            working = working.replacingOccurrences(
                of: pattern,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        let finalMatches = regexMatches(#"<final\b[^>]*>([\s\S]*?)</final>"#, in: working)
            .compactMap { match in
                match.count > 1 ? match[1].trimmingCharacters(in: .whitespacesAndNewlines) : nil
            }
            .filter { !$0.isEmpty }

        var visible = finalMatches.isEmpty ? stripDanglingAssistantMarkup(working) : finalMatches.joined(separator: "\n\n")
        visible = stripDanglingAssistantMarkup(visible)

        return NativeAssistantMarkupResult(
            content: visible.trimmingCharacters(in: .whitespacesAndNewlines),
            thinking: thinking.joined(separator: "\n\n")
        )
    }

    static func normalizeCodeLanguage(_ rawLanguage: String) -> String {
        let key = rawLanguage.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if key.isEmpty { return "text" }
        let aliases = [
            "sh": "bash",
            "zsh": "bash",
            "shell": "bash",
            "js": "javascript",
            "jsx": "jsx",
            "ts": "typescript",
            "tsx": "tsx",
            "md": "markdown",
            "yml": "yaml",
            "plain": "text",
            "plaintext": "text",
        ]
        return aliases[key] ?? key
    }

    static func looksLikeDiff(code: String, language: String) -> Bool {
        if language == "diff" || language == "patch" { return true }
        return code.components(separatedBy: "\n").prefix(12).contains { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            return trimmed.hasPrefix("diff --git") || trimmed.hasPrefix("@@")
                || trimmed.hasPrefix("+++ ") || trimmed.hasPrefix("--- ")
        }
    }

    private static func startsBlock(_ line: String, lines: [String], index: Int) -> Bool {
        line.hasPrefix("```") || isHorizontalRule(line) || parseHeading(line) != nil
            || parseUnorderedItem(line) != nil || parseOrderedItem(line) != nil
            || parseImage(line) != nil || line.hasPrefix(">") || isTableStart(lines, at: index)
    }

    private static func parseImage(_ line: String) -> (alt: String, source: String)? {
        let matches = regexMatches(#"^!\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^\s\)]+))(?:\s+[\"'][^\"'\n]*[\"'])?\s*\)$"#, in: line)
        guard let match = matches.first, match.count >= 3 else { return nil }
        let source = match.last?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if source.hasPrefix("file://") {
            guard let fileURL = URL(string: source),
                  fileURL.path.range(
                    of: #"/screenshots/[^/]+\.(?:png|jpe?g|gif|webp)$"#,
                    options: [.regularExpression, .caseInsensitive]
                  ) != nil else { return nil }
        } else {
            guard source.hasPrefix("https://") || source.hasPrefix("http://")
                || source.hasPrefix("data:image/") else { return nil }
        }
        return (match[1], source)
    }

    private static func stripInboundContextBlocks(_ raw: String) -> String {
        guard inboundContextHeaders.contains(where: { raw.contains($0) }) else { return raw }
        let lines = raw.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var output: [String] = []
        var inMetaBlock = false
        var inFencedJSON = false

        for line in lines {
            if !inMetaBlock && inboundContextHeaders.contains(where: { line.hasPrefix($0) }) {
                inMetaBlock = true
                inFencedJSON = false
                continue
            }

            if inMetaBlock {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if !inFencedJSON && trimmed == "```json" {
                    inFencedJSON = true
                    continue
                }
                if inFencedJSON {
                    if trimmed == "```" {
                        inMetaBlock = false
                        inFencedJSON = false
                    }
                    continue
                }
                if trimmed.isEmpty {
                    continue
                }
                inMetaBlock = false
            }

            output.append(line)
        }

        return output.joined(separator: "\n").trimmingCharacters(in: CharacterSet(charactersIn: "\n"))
    }

    private static func stripPrefixedTimestamps(_ raw: String) -> String {
        let pattern =
            #"^\[[A-Za-z]{3}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:GMT|UTC)[+-]?\d{0,2}\]\s*"#
        return raw.replacingOccurrences(of: pattern, with: "", options: [.regularExpression])
    }

    private static func collapseBlankLines(_ raw: String) -> String {
        raw.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: [.regularExpression])
    }

    private static func stripDanglingAssistantMarkup(_ raw: String) -> String {
        stripTextToolCallMarkup(raw)
            .replacingOccurrences(
            of: "<(?:" + reasoningTagNamePattern + #")\b[^>]*>[\s\S]*$"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        .replacingOccurrences(
            of: #"\[(?:thinking|reasoning)\][\s\S]*$"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        .replacingOccurrences(
            of: "</?(?:" + reasoningTagNamePattern + #"|final)\b[^>]*>"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        .replacingOccurrences(
            of: #"\[/?(?:thinking|reasoning)\]"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
    }

    private static func stripTextToolCallMarkup(_ raw: String) -> String {
        var working = raw
        let patterns = [
            #"\]?<\]minimax\[\>\[?"#,
            "<[|\\x{FF5C}][^|\\x{FF5C}]*[|\\x{FF5C}]>",
            "<[|\\x{FF5C}]DSML[|\\x{FF5C}](?:tool_calls|tool_call|function_calls|tool_use_error)>[\\s\\S]*?</[|\\x{FF5C}]DSML[|\\x{FF5C}](?:tool_calls|tool_call|function_calls|tool_use_error)>",
            #"<(?:function_response|tool_result)\b[^>]*>[\s\S]*?</(?:function_response|tool_result)>"#,
            #"<(?:function_calls|function_call|tool_calls|tool_call)\b[^>]*>[\s\S]*?</(?:function_calls|function_call|tool_calls|tool_call)>"#,
            #"\[\s*TOOL_CALL\s*\][\s\S]*?(?:\[\s*/\s*TOOL_CALL\s*\]|$)"#,
            #"\[\s*TOOL_RESULT\s*\][\s\S]*?(?:\[\s*/\s*TOOL_RESULT\s*\]|$)"#,
            #"<function=[A-Za-z_][A-Za-z0-9_.:-]{0,119}>[\s\S]*?</function>"#,
            #"<function\b[^>]*>[\s\S]*?</function>"#,
            #"<invoke\b[^>]*>[\s\S]*?</invoke>"#,
            #"<(?:function_call|tool_call)\b[^>]*>\s*(?:[\{\[]|<invoke\b|["']?(?:name|tool_name|function)["']?\s*[:=])[^\r\n]*(?=\r?\n|$)"#,
            #"</?(?:function_calls?|tool_calls?|tool_result|function_response|function|invoke|parameter|param)\b[^>]*>"#,
        ]

        for pattern in patterns {
            working = working.replacingOccurrences(
                of: pattern,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        return collapseBlankLines(working)
    }

    private static func regexMatches(_ pattern: String, in raw: String) -> [[String]] {
        guard let regex = try? NSRegularExpression(
            pattern: pattern,
            options: [.caseInsensitive]
        ) else { return [] }

        let nsRange = NSRange(raw.startIndex ..< raw.endIndex, in: raw)
        return regex.matches(in: raw, range: nsRange).map { result in
            (0 ..< result.numberOfRanges).compactMap { index in
                let range = result.range(at: index)
                guard range.location != NSNotFound, let swiftRange = Range(range, in: raw) else {
                    return nil
                }
                return String(raw[swiftRange])
            }
        }
    }

    private static func parseHeading(_ line: String) -> (level: Int, text: String)? {
        var count = 0
        for character in line {
            if character == "#" {
                count += 1
            } else {
                break
            }
        }
        guard (1 ... 6).contains(count), line.dropFirst(count).first == " " else { return nil }
        return (count, String(line.dropFirst(count + 1)).trimmingCharacters(in: .whitespaces))
    }

    private static func parseUnorderedItem(_ line: String) -> String? {
        guard line.count > 2 else { return nil }
        let marker = line[line.startIndex]
        guard marker == "-" || marker == "*" || marker == "+" else { return nil }
        let next = line.index(after: line.startIndex)
        guard line[next] == " " else { return nil }
        return String(line[line.index(after: next)...]).trimmingCharacters(in: .whitespaces)
    }

    private static func parseOrderedItem(_ line: String) -> String? {
        guard let dot = line.firstIndex(of: ".") else { return nil }
        let prefix = line[..<dot]
        guard !prefix.isEmpty, prefix.allSatisfy(\.isNumber) else { return nil }
        let afterDot = line.index(after: dot)
        guard afterDot < line.endIndex, line[afterDot] == " " else { return nil }
        return String(line[line.index(after: afterDot)...]).trimmingCharacters(in: .whitespaces)
    }

    private static func isHorizontalRule(_ line: String) -> Bool {
        let compact = line.filter { !$0.isWhitespace }
        return compact.count >= 3 && (compact.allSatisfy { $0 == "-" } || compact.allSatisfy { $0 == "*" })
    }

    private static func isTableStart(_ lines: [String], at index: Int) -> Bool {
        guard index + 1 < lines.count, lines[index].contains("|") else { return false }
        let separator = lines[index + 1].trimmingCharacters(in: .whitespaces)
        guard separator.contains("|") else { return false }
        let cells = parseTableRow(separator)
        return cells.count >= 2 && cells.allSatisfy { cell in
            let compact = cell.filter { !$0.isWhitespace }
            return compact.count >= 3 && compact.allSatisfy { $0 == "-" || $0 == ":" }
        }
    }

    private static func parseTableRow(_ line: String) -> [String] {
        var trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("|") { trimmed.removeFirst() }
        if trimmed.hasSuffix("|") { trimmed.removeLast() }
        return trimmed.split(separator: "|", omittingEmptySubsequences: false)
            .map { String($0).trimmingCharacters(in: .whitespaces) }
    }
}

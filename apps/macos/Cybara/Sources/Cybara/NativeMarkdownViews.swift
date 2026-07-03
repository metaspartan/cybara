import AppKit
import SwiftUI

struct NativeMarkdownView: View {
    let content: String
    let isUser: Bool

    private var blocks: [NativeMarkdownBlock] {
        NativeMarkdown.parse(content, stripAssistantMarkup: !isUser)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(blocks) { block in
                blockView(block)
            }
        }
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func blockView(_ block: NativeMarkdownBlock) -> some View {
        switch block.kind {
        case .paragraph(let text):
            inlineText(text)
                .font(.system(size: isUser ? 13 : 12.5, design: .rounded))
                .lineSpacing(3)
        case .heading(let level, let text):
            inlineText(text)
                .font(.system(size: headingSize(level), weight: .bold, design: .rounded))
        case .unorderedList(let items):
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    listRow(marker: "•", text: item)
                }
            }
        case .orderedList(let items):
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    listRow(marker: "\(index + 1).", text: item)
                }
            }
        case .code(let language, let code, let isDiff):
            NativeCodeBlock(language: language, code: code, isDiff: isDiff)
        case .blockquote(let text):
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color.accentColor.opacity(0.65))
                    .frame(width: 3)
                inlineText(text)
                    .font(.system(size: 12.5, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 2)
        case .table(let rows):
            NativeMarkdownTable(rows: rows)
        case .horizontalRule:
            Divider()
                .padding(.vertical, 4)
        }
    }

    private func inlineText(_ text: String) -> Text {
        if let attributed = try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        ) {
            return Text(attributed)
        }
        return Text(text)
    }

    private func listRow(marker: String, text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(marker)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .frame(width: 22, alignment: .trailing)
            inlineText(text)
                .font(.system(size: 12.5, design: .rounded))
                .lineSpacing(3)
        }
    }

    private func headingSize(_ level: Int) -> CGFloat {
        switch level {
        case 1: return 20
        case 2: return 17
        case 3: return 15
        default: return 13.5
        }
    }
}

private struct NativeCodeBlock: View {
    let language: String
    let code: String
    let isDiff: Bool
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(isDiff ? "diff" : language)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                Spacer()
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(code, forType: .string)
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.white.opacity(0.04))

            ScrollView(.horizontal) {
                if isDiff {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(code.components(separatedBy: "\n").enumerated()), id: \.offset) {
                            index, line in
                            DiffLine(number: index + 1, line: line)
                        }
                    }
                    .padding(.vertical, 6)
                } else {
                    Text(code.isEmpty ? " " : code)
                        .font(.system(size: 11.5, design: .monospaced))
                        .foregroundStyle(.primary)
                        .padding(10)
                }
            }
        }
        .background(.black.opacity(0.28), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
        .onChange(of: copied) { _, value in
            guard value else { return }
            Task {
                try? await Task.sleep(for: .seconds(1.4))
                copied = false
            }
        }
    }
}

private struct DiffLine: View {
    let number: Int
    let line: String

    var body: some View {
        HStack(spacing: 0) {
            Text("\(number)")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 42, alignment: .trailing)
                .padding(.trailing, 8)
            Text(marker)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(color)
                .frame(width: 20)
            Text(line.isEmpty ? " " : line)
                .font(.system(size: 11.5, design: .monospaced))
                .foregroundStyle(color)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 1)
        .background(background)
    }

    private var marker: String {
        if line.hasPrefix("+") { return "+" }
        if line.hasPrefix("-") { return "-" }
        if line.trimmingCharacters(in: .whitespaces).hasPrefix("@@") { return "↕" }
        return " "
    }

    private var color: Color {
        if line.hasPrefix("+") { return .green }
        if line.hasPrefix("-") { return .red }
        if line.trimmingCharacters(in: .whitespaces).hasPrefix("@@") { return .blue }
        return .primary
    }

    private var background: Color {
        if line.hasPrefix("+") { return .green.opacity(0.10) }
        if line.hasPrefix("-") { return .red.opacity(0.10) }
        if line.trimmingCharacters(in: .whitespaces).hasPrefix("@@") { return .blue.opacity(0.10) }
        return .clear
    }
}

private struct NativeMarkdownTable: View {
    let rows: [[String]]

    var body: some View {
        ScrollView(.horizontal) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, row in
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                            Text(cell)
                                .font(.system(
                                    size: 11.5,
                                    weight: rowIndex == 0 ? .semibold : .regular,
                                    design: .rounded
                                ))
                                .frame(minWidth: 110, alignment: .leading)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 7)
                                .border(.white.opacity(0.08), width: 0.5)
                        }
                    }
                    .background(rowIndex == 0 ? Color.white.opacity(0.05) : Color.clear)
                }
            }
        }
        .background(.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

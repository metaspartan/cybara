import AppKit
import SwiftUI

extension View {
    func nativeWorkspacePanelVisibility(_ visible: Bool) -> some View {
        opacity(visible ? 1 : 0)
            .allowsHitTesting(visible)
            .accessibilityHidden(!visible)
    }
}

private func nativeChatPathSegment(_ value: String) -> String {
    var allowed = CharacterSet.urlPathAllowed
    allowed.remove(charactersIn: "/")
    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
}

enum NativeChatWorkspaceTab: String, CaseIterable, Identifiable {
    case review
    case terminal
    case browser
    case files
    case subagents

    var id: String { rawValue }

    var label: String {
        switch self {
        case .review: "Review"
        case .terminal: "Terminal"
        case .browser: "Browser"
        case .files: "Files"
        case .subagents: "Side Task"
        }
    }

    var systemImage: String {
        switch self {
        case .review: "doc.text.magnifyingglass"
        case .terminal: "terminal"
        case .browser: "globe"
        case .files: "folder"
        case .subagents: "person.2"
        }
    }
}

struct NativeChatWorkspaceHeader: View {
    @Binding var selection: NativeChatWorkspaceTab
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Picker("Workspace tool", selection: $selection) {
                ForEach(NativeChatWorkspaceTab.allCases) { tab in
                    Label(tab.label, systemImage: tab.systemImage).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Button(action: onClose) {
                Image(systemName: "sidebar.right")
            }
            .buttonStyle(.borderless)
            .help("Close workspace panel")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.regularMaterial)
    }
}

private struct NativeBrowserTab: Decodable, Identifiable, Hashable {
    let id: String
    let title: String?
    let url: String?
}

private struct NativeBrowserTabsEnvelope: Decodable {
    let tabs: [NativeBrowserTab]
}

private struct NativeBrowserCreateData: Decodable {
    let id: String
}

private struct NativeBrowserCreateEnvelope: Decodable {
    let success: Bool?
    let data: NativeBrowserCreateData
}

private struct NativeBrowserScreenshotData: Decodable {
    let screenshot: String
    let cursor: NativeBrowserCursor?
    let viewport: NativeBrowserViewport?
    let page: NativeBrowserTab?
}

private struct NativeBrowserScreenshotEnvelope: Decodable {
    let success: Bool?
    let data: NativeBrowserScreenshotData
}

private struct NativeBrowserCursor: Decodable {
    let x: Double
    let y: Double
    let visible: Bool
    let updatedAt: Double?
    let source: String?
}

private struct NativeBrowserViewport: Decodable {
    let width: Double
    let height: Double
}

private struct NativeBrowserPreview {
    let image: NSImage?
    let cursor: NativeBrowserCursor?
    let viewport: NativeBrowserViewport?
    let page: NativeBrowserTab?
}

extension GatewayClient {
    fileprivate func chatBrowserTabs(sessionID: String) async throws -> [NativeBrowserTab] {
        let data = try await request(
            "api/browser/tabs",
            queryItems: [URLQueryItem(name: "sessionId", value: sessionID)]
        )
        return try JSONDecoder().decode(NativeBrowserTabsEnvelope.self, from: data).tabs
    }

    fileprivate func createChatBrowserTab(sessionID: String) async throws -> String {
        let body = try JSONSerialization.data(withJSONObject: ["sessionId": sessionID])
        let data = try await request("api/browser/tabs", method: "POST", body: body)
        return try JSONDecoder().decode(NativeBrowserCreateEnvelope.self, from: data).data.id
    }

    fileprivate func navigateChatBrowserTab(_ id: String, url: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "url": url,
            "waitUntil": "domcontentloaded",
        ])
        _ = try await request(
            "api/browser/tabs/\(nativeChatPathSegment(id))/navigate",
            method: "POST",
            body: body
        )
    }

    fileprivate func runChatBrowserAction(_ id: String, action: String) async throws {
        _ = try await request(
            "api/browser/tabs/\(nativeChatPathSegment(id))/\(nativeChatPathSegment(action))",
            method: "POST"
        )
    }

    fileprivate func chatBrowserScreenshot(_ id: String) async throws -> NativeBrowserPreview {
        let data = try await request(
            "api/browser/tabs/\(nativeChatPathSegment(id))/screenshot",
            queryItems: [URLQueryItem(name: "fullPage", value: "false")]
        )
        let payload = try JSONDecoder().decode(NativeBrowserScreenshotEnvelope.self, from: data).data
        let encoded = payload.screenshot
        guard let imageData = Data(base64Encoded: encoded) else {
            return NativeBrowserPreview(
                image: nil,
                cursor: payload.cursor,
                viewport: payload.viewport,
                page: payload.page
            )
        }
        return NativeBrowserPreview(
            image: NSImage(data: imageData),
            cursor: payload.cursor,
            viewport: payload.viewport,
            page: payload.page
        )
    }
}

struct NativeChatBrowserPanel: View {
    let client: GatewayClient
    let sessionID: String?
    @State private var page: NativeBrowserTab?
    @State private var address = ""
    @State private var image: NSImage?
    @State private var cursor: NativeBrowserCursor?
    @State private var viewport: NativeBrowserViewport?
    @State private var loading = false
    @State private var error: String?

    private var browserSessionID: String {
        firstNonEmptyGatewayString(sessionID) ?? "preview-new-chat"
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Button {
                    Task { await runAction("back") }
                } label: {
                    Image(systemName: "chevron.left")
                }
                .buttonStyle(.borderless)
                .disabled(page == nil || loading)
                .help("Go back")

                Button {
                    Task { await runAction("forward") }
                } label: {
                    Image(systemName: "chevron.right")
                }
                .buttonStyle(.borderless)
                .disabled(page == nil || loading)
                .help("Go forward")

                Button {
                    Task { await runAction("reload") }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .disabled(page == nil || loading)
                .help("Reload page")

                TextField("Search or enter address", text: $address)
                    .textFieldStyle(.roundedBorder)
                    .multilineTextAlignment(.center)
                    .onSubmit { Task { await navigate() } }
            }
            .padding(8)

            Divider()

            ZStack {
                if let image {
                    GeometryReader { proxy in
                        Image(nsImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: proxy.size.width, height: proxy.size.height)
                            .clipped()
                        if let cursor, let viewport, cursor.visible, cursor.source != "user", viewport.width > 0, viewport.height > 0 {
                            Image(systemName: "arrow.up.left")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(.white, .black)
                                .shadow(color: .black.opacity(0.8), radius: 2)
                                .position(
                                    x: proxy.size.width * cursor.x / viewport.width,
                                    y: proxy.size.height * cursor.y / viewport.height
                                )
                                .animation(.easeOut(duration: 0.5), value: cursor.updatedAt ?? 0)
                        }
                    }
                } else if loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ContentUnavailableView(
                        "No Browser Preview",
                        systemImage: "globe",
                        description: Text("Open a browser tab to follow the agent's browser activity.")
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if let error {
                Text(error)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.red)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task(id: browserSessionID) {
            await loadPage()
            while !Task.isCancelled {
                await refreshPreview()
                try? await Task.sleep(for: .milliseconds(900))
            }
        }
    }

    private func loadPage() async {
        do {
            let pages = try await client.chatBrowserTabs(sessionID: browserSessionID)
            if let existing = pages.first {
                page = existing
            } else {
                let id = try await client.createChatBrowserTab(sessionID: browserSessionID)
                page = NativeBrowserTab(id: id, title: nil, url: nil)
            }
            address = page?.url ?? ""
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func runAction(_ action: String) async {
        guard let page else { return }
        do {
            try await client.runChatBrowserAction(page.id, action: action)
            await refreshPreview()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func navigate() async {
        guard let page else { return }
        let target = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else { return }
        do {
            try await client.navigateChatBrowserTab(page.id, url: target)
            await refreshPreview()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func refreshPreview() async {
        guard let page, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let preview = try await client.chatBrowserScreenshot(page.id)
            image = preview.image
            cursor = preview.cursor
            viewport = preview.viewport
            if let updatedPage = preview.page {
                self.page = updatedPage
                address = updatedPage.url ?? address
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct NativeChatFilesPanel: View {
    let client: GatewayClient
    let workspacePath: String?
    @State private var currentPath = ""
    @State private var browse: NativeIDEBrowseResult?
    @State private var selectedFile: NativeIDEReadResult?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Button {
                    if let parent = browse?.parent { Task { await load(parent) } }
                } label: {
                    Image(systemName: "chevron.up")
                }
                .disabled(browse?.parent == nil)
                TextField("Workspace path", text: $currentPath)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await load(currentPath) } }
                Button {
                    Task { await load(currentPath) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
            .padding(8)

            Divider()

            HSplitView {
                List(browse?.entries ?? [], selection: Binding(
                    get: { selectedFile?.path },
                    set: { _ in }
                )) { entry in
                    Button {
                        Task {
                            if entry.type == "directory" { await load(entry.path) }
                            else { await read(entry.path) }
                        }
                    } label: {
                        Label(entry.name, systemImage: entry.type == "directory" ? "folder" : "doc")
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                }
                .frame(minWidth: 160, idealWidth: 210)

                ScrollView {
                    Text(selectedFile?.content ?? "Select a file to preview")
                        .font(.system(size: 11, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .padding(10)
                }
                .frame(minWidth: 180, maxWidth: .infinity)
            }

            if loading { ProgressView().controlSize(.small).padding(6) }
            if let error {
                Text(error).font(.caption).foregroundStyle(.red).padding(6)
            }
        }
        .task(id: workspacePath) {
            currentPath = workspacePath ?? ""
            if !currentPath.isEmpty { await load(currentPath) }
        }
    }

    private func load(_ path: String) async {
        guard !path.isEmpty else { return }
        loading = true
        defer { loading = false }
        do {
            browse = try await client.browseIDE(path: path)
            currentPath = browse?.path ?? path
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func read(_ path: String) async {
        loading = true
        defer { loading = false }
        do {
            selectedFile = try await client.readIDEFile(path: path)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

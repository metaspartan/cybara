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
    case computer
    case files
    case subagents

    var id: String { rawValue }

    var label: String {
        switch self {
        case .review: "Review"
        case .terminal: "Terminal"
        case .browser: "Browser"
        case .computer: "Desktop"
        case .files: "IDE"
        case .subagents: "Side Task"
        }
    }

    var systemImage: String {
        switch self {
        case .review: "doc.text.magnifyingglass"
        case .terminal: "terminal"
        case .browser: "globe"
        case .computer: "display"
        case .files: "hammer"
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
    let screenshot: String?
    let revision: String
    let cursor: NativeBrowserCursor?
    let viewport: NativeBrowserViewport?
    let viewportMode: String?
    let page: NativeBrowserTab?
}

private struct NativeBrowserScreenshotEnvelope: Decodable {
    let success: Bool?
    let data: NativeBrowserScreenshotData
}

private struct NativeBrowserStateData: Decodable {
    let cursor: NativeBrowserCursor?
    let viewport: NativeBrowserViewport?
    let viewportMode: String?
    let page: NativeBrowserTab?
}

private struct NativeBrowserStateEnvelope: Decodable {
    let success: Bool?
    let data: NativeBrowserStateData
}

private struct NativeBrowserViewportEnvelope: Decodable {
    let success: Bool?
    let data: NativeBrowserViewportData
}

private struct NativeBrowserViewportData: Decodable {
    let viewport: NativeBrowserViewport
    let viewportMode: String?
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

private enum NativeBrowserViewportMode: String, CaseIterable, Identifiable {
    case responsive
    case mobile
    case desktop

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .responsive: "viewfinder"
        case .mobile: "iphone"
        case .desktop: "display"
        }
    }
}

private func nativeBrowserViewport(
    mode: NativeBrowserViewportMode,
    container: CGSize
) -> NativeBrowserViewport {
    switch mode {
    case .mobile:
        return NativeBrowserViewport(width: 390, height: 844)
    case .desktop:
        return NativeBrowserViewport(width: 1_440, height: 900)
    case .responsive:
        let sourceWidth = max(320, container.width.rounded())
        let sourceHeight = max(320, container.height.rounded())
        let scale = min(1, 1_600 / sourceWidth, 1_200 / sourceHeight)
        return NativeBrowserViewport(
            width: max(320, (sourceWidth * scale).rounded()),
            height: max(320, (sourceHeight * scale).rounded())
        )
    }
}

private struct NativeBrowserPreview {
    let image: NSImage?
    let revision: String
    let cursor: NativeBrowserCursor?
    let viewport: NativeBrowserViewport?
    let viewportMode: String?
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

    fileprivate func chatBrowserScreenshot(
        _ id: String,
        revision: String,
        viewport: NativeBrowserViewport
    ) async throws -> NativeBrowserPreview {
        var queryItems = [
            URLQueryItem(name: "fullPage", value: "false"),
            URLQueryItem(name: "format", value: "jpeg"),
            URLQueryItem(name: "quality", value: "58"),
            URLQueryItem(name: "viewportWidth", value: String(Int(viewport.width))),
            URLQueryItem(name: "viewportHeight", value: String(Int(viewport.height))),
        ]
        if !revision.isEmpty {
            queryItems.append(URLQueryItem(name: "revision", value: revision))
        }
        let data = try await request(
            "api/browser/tabs/\(nativeChatPathSegment(id))/screenshot",
            queryItems: queryItems
        )
        let payload = try JSONDecoder().decode(NativeBrowserScreenshotEnvelope.self, from: data).data
        guard let encoded = payload.screenshot,
              let imageData = Data(base64Encoded: encoded) else {
            return NativeBrowserPreview(
                image: nil,
                revision: payload.revision,
                cursor: payload.cursor,
                viewport: payload.viewport,
                viewportMode: payload.viewportMode,
                page: payload.page
            )
        }
        return NativeBrowserPreview(
            image: NSImage(data: imageData),
            revision: payload.revision,
            cursor: payload.cursor,
            viewport: payload.viewport,
            viewportMode: payload.viewportMode,
            page: payload.page
        )
    }

    fileprivate func chatBrowserState(_ id: String) async throws -> NativeBrowserPreview {
        let data = try await request("api/browser/tabs/\(nativeChatPathSegment(id))/state")
        let payload = try JSONDecoder().decode(NativeBrowserStateEnvelope.self, from: data).data
        return NativeBrowserPreview(
            image: nil,
            revision: "",
            cursor: payload.cursor,
            viewport: payload.viewport,
            viewportMode: payload.viewportMode,
            page: payload.page
        )
    }

    fileprivate func resizeChatBrowserTab(
        _ id: String,
        viewport: NativeBrowserViewport,
        mode: NativeBrowserViewportMode
    ) async throws -> NativeBrowserViewport {
        let body = try JSONSerialization.data(withJSONObject: [
            "width": Int(viewport.width),
            "height": Int(viewport.height),
            "viewportMode": mode.rawValue,
        ])
        let data = try await request(
            "api/browser/tabs/\(nativeChatPathSegment(id))/viewport",
            method: "POST",
            body: body
        )
        return try JSONDecoder().decode(NativeBrowserViewportEnvelope.self, from: data).data.viewport
    }
}

struct NativeChatBrowserPanel: View {
    let client: GatewayClient
    let sessionID: String?
    let isActive: Bool
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @AppStorage("cybara.browser.viewport-mode") private var viewportModeRaw = NativeBrowserViewportMode.responsive.rawValue
    @StateObject private var stream = NativeBrowserStreamConnection()
    @State private var page: NativeBrowserTab?
    @State private var address = ""
    @State private var image: NSImage?
    @State private var revision = ""
    @State private var cursor: NativeBrowserCursor?
    @State private var viewport: NativeBrowserViewport?
    @State private var requestedViewport = NativeBrowserViewport(width: 960, height: 640)
    @State private var loading = false
    @State private var error: String?
    @FocusState private var addressFocused: Bool

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
                    .focused($addressFocused)
                    .onSubmit { Task { await navigate() } }

                Picker("Browser viewport", selection: $viewportModeRaw) {
                    ForEach(NativeBrowserViewportMode.allCases) { mode in
                        Image(systemName: mode.systemImage)
                            .tag(mode.rawValue)
                            .help(mode.rawValue.capitalized)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 92)
            }
            .padding(8)

            Divider()

            GeometryReader { proxy in
                let mode = NativeBrowserViewportMode(rawValue: viewportModeRaw) ?? .responsive
                let targetViewport = nativeBrowserViewport(mode: mode, container: proxy.size)
                ZStack {
                    if let presentedImage = stream.image ?? image {
                        Image(nsImage: presentedImage)
                            .resizable()
                            .scaledToFit()
                            .frame(width: proxy.size.width, height: proxy.size.height)
                        if let cursor, let viewport, cursor.visible, cursor.source != "user", viewport.width > 0, viewport.height > 0 {
                            Image(systemName: "arrow.up.left")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(.white, .black)
                                .shadow(color: .black.opacity(0.8), radius: 2)
                                .position(nativePreviewPosition(
                                    cursorX: cursor.x,
                                    cursorY: cursor.y,
                                    viewportWidth: viewport.width,
                                    viewportHeight: viewport.height,
                                    container: proxy.size
                                ))
                                .animation(systemReduceMotion ? nil : .easeOut(duration: 0.15), value: cursor.updatedAt ?? 0)
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
                .frame(width: proxy.size.width, height: proxy.size.height)
                .task(id: "\(page?.id ?? "none"):\(Int(targetViewport.width))x\(Int(targetViewport.height))") {
                    try? await Task.sleep(for: .milliseconds(100))
                    guard !Task.isCancelled else { return }
                    await resizeViewport(targetViewport, mode: mode)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .textBackgroundColor).opacity(0.45))

            if let error {
                Text(error)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.red)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task(id: "\(browserSessionID):\(isActive)") {
            guard isActive else {
                stream.disconnect()
                return
            }
            await loadPage()
            while !Task.isCancelled {
                guard let page else {
                    try? await Task.sleep(for: .milliseconds(500))
                    continue
                }
                if !stream.connected {
                    stream.connect(client: client, pageID: page.id)
                }
                if stream.image == nil {
                    await refreshPreview()
                } else {
                    await refreshState()
                }
                try? await Task.sleep(for: .milliseconds(stream.connected ? 1_250 : 750))
            }
        }
        .onDisappear { stream.disconnect() }
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
            if let page {
                stream.connect(client: client, pageID: page.id)
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
            await refreshState()
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
            await refreshState()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func refreshPreview() async {
        guard let page, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let preview = try await client.chatBrowserScreenshot(
                page.id,
                revision: revision,
                viewport: requestedViewport
            )
            if let nextImage = preview.image {
                image = nextImage
            }
            revision = preview.revision
            applyPreviewMetadata(preview)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func refreshState() async {
        guard let page, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let preview = try await client.chatBrowserState(page.id)
            applyPreviewMetadata(preview)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func applyPreviewMetadata(_ preview: NativeBrowserPreview) {
        cursor = preview.cursor
        viewport = preview.viewport
        if let mode = preview.viewportMode,
           NativeBrowserViewportMode(rawValue: mode) != nil,
           viewportModeRaw != mode {
            viewportModeRaw = mode
        }
        if let updatedPage = preview.page {
            page = updatedPage
            if !addressFocused {
                address = updatedPage.url ?? address
            }
        }
    }

    private func resizeViewport(
        _ target: NativeBrowserViewport,
        mode: NativeBrowserViewportMode
    ) async {
        guard let page else { return }
        do {
            let applied = try await client.resizeChatBrowserTab(page.id, viewport: target, mode: mode)
            requestedViewport = applied
            viewport = applied
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private func nativePreviewPosition(
    cursorX: Double,
    cursorY: Double,
    viewportWidth: Double,
    viewportHeight: Double,
    container: CGSize
) -> CGPoint {
    guard viewportWidth > 0, viewportHeight > 0, container.width > 0, container.height > 0 else {
        return CGPoint(x: container.width / 2, y: container.height / 2)
    }
    let scale = min(container.width / viewportWidth, container.height / viewportHeight)
    let width = viewportWidth * scale
    let height = viewportHeight * scale
    return CGPoint(
        x: (container.width - width) / 2 + cursorX * scale,
        y: (container.height - height) / 2 + cursorY * scale
    )
}

private struct NativeComputerPreviewCursor: Decodable {
    let x: Double
    let y: Double
    let visible: Bool
    let action: String
    let updatedAt: Double
}

private struct NativeComputerPreviewData: Decodable {
    let action: String
    let app: String?
    let screenshot: String?
    let contentType: String?
    let viewport: NativeComputerPreviewViewport?
    let cursor: NativeComputerPreviewCursor?
    let screenshotRevision: Int
}

private struct NativeComputerPreviewViewport: Decodable {
    let width: Double
    let height: Double
}

private struct NativeComputerPreviewEnvelope: Decodable {
    let success: Bool
    let data: NativeComputerPreviewData?
}

extension GatewayClient {
    fileprivate func computerPreview(
        sessionID: String,
        screenshotRevision: Int
    ) async throws -> NativeComputerPreviewData? {
        let data = try await request(
            "api/computer-use/preview",
            queryItems: [
                URLQueryItem(name: "sessionId", value: sessionID),
                URLQueryItem(name: "screenshotRevision", value: String(screenshotRevision)),
            ]
        )
        return try JSONDecoder().decode(NativeComputerPreviewEnvelope.self, from: data).data
    }

    fileprivate func clearComputerPreview(sessionID: String) async throws {
        _ = try await request(
            "api/computer-use/preview",
            method: "DELETE",
            queryItems: [URLQueryItem(name: "sessionId", value: sessionID)]
        )
    }
}

struct NativeChatComputerPanel: View {
    let client: GatewayClient
    let sessionID: String?
    let isActive: Bool
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @State private var image: NSImage?
    @State private var cursor: NativeComputerPreviewCursor?
    @State private var action = ""
    @State private var app = ""
    @State private var screenshotRevision = 0
    @State private var viewport: NativeComputerPreviewViewport?
    @State private var error: String?

    private var resolvedSessionID: String {
        firstNonEmptyGatewayString(sessionID) ?? "preview-new-chat"
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "display")
                    .foregroundStyle(.secondary)
                Text(action.isEmpty ? "Desktop" : "\(app.isEmpty ? "Desktop" : app) · \(action.replacingOccurrences(of: "_", with: " "))")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                if image != nil {
                    Button {
                        Task { await clear() }
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .help("Clear desktop preview")
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 38)

            Divider()

            ZStack {
                if let image {
                    GeometryReader { proxy in
                        Image(nsImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(width: proxy.size.width, height: proxy.size.height)
                        if let cursor, cursor.visible {
                            Image(systemName: "arrow.up.left")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(.white, .black)
                                .shadow(color: .black.opacity(0.8), radius: 2)
                                .position(nativePreviewPosition(
                                    cursorX: cursor.x,
                                    cursorY: cursor.y,
                                    viewportWidth: viewport?.width ?? image.size.width,
                                    viewportHeight: viewport?.height ?? image.size.height,
                                    container: proxy.size
                                ))
                                .animation(systemReduceMotion ? nil : .easeOut(duration: 0.15), value: cursor.updatedAt)
                        }
                    }
                } else {
                    ContentUnavailableView(
                        "No Desktop Preview",
                        systemImage: "display",
                        description: Text(error ?? "Computer-use activity for this chat appears here.")
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .textBackgroundColor).opacity(0.45))
        }
        .task(id: "\(resolvedSessionID):\(isActive)") {
            guard isActive else { return }
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(for: .milliseconds(300))
            }
        }
    }

    private func refresh() async {
        do {
            guard let preview = try await client.computerPreview(
                sessionID: resolvedSessionID,
                screenshotRevision: screenshotRevision
            ) else {
                error = nil
                return
            }
            action = preview.action
            app = preview.app ?? app
            cursor = preview.cursor
            viewport = preview.viewport ?? viewport
            if let encoded = preview.screenshot,
               let data = Data(base64Encoded: encoded),
               let nextImage = NSImage(data: data) {
                image = nextImage
                screenshotRevision = preview.screenshotRevision
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func clear() async {
        do {
            try await client.clearComputerPreview(sessionID: resolvedSessionID)
            image = nil
            cursor = nil
            action = ""
            app = ""
            screenshotRevision = 0
            viewport = nil
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
    @State private var fileContent = ""
    @State private var savedContent = ""
    @State private var lspStatus: NativeLSPStatus?
    @State private var loading = false
    @State private var saving = false
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

                VStack(spacing: 0) {
                    HStack(spacing: 8) {
                        Image(systemName: "doc.text")
                            .foregroundStyle(.secondary)
                        Text(selectedFile?.path.split(separator: "/").last.map(String.init) ?? "Select a file")
                            .font(.caption)
                            .lineLimit(1)
                        if fileContent != savedContent {
                            Circle().fill(.secondary).frame(width: 5, height: 5)
                        }
                        Spacer()
                        Button {
                            Task { await save() }
                        } label: {
                            if saving { ProgressView().controlSize(.small) }
                            else { Image(systemName: "square.and.arrow.down") }
                        }
                        .buttonStyle(.borderless)
                        .disabled(selectedFile == nil || fileContent == savedContent || saving)
                        .help("Save file")
                    }
                    .padding(.horizontal, 10)
                    .frame(height: 34)

                    Divider()

                    if selectedFile == nil {
                        ContentUnavailableView("Select a File", systemImage: "doc.text")
                    } else {
                        TextEditor(text: $fileContent)
                            .font(.system(size: 11, design: .monospaced))
                            .scrollContentBackground(.hidden)
                            .padding(6)
                    }

                    Divider()

                    HStack(spacing: 8) {
                        Image(systemName: "bolt.horizontal")
                        Text("LSP")
                        Text(lspStatus?.status ?? "unavailable")
                            .foregroundStyle(lspStatus?.status == "healthy" ? .green : .secondary)
                        Spacer()
                        Text("\(lspStatus?.diagnosticsCount ?? 0) diagnostics")
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .frame(height: 28)
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
            async let statusLoad: Void = refreshLSP()
            if !currentPath.isEmpty { await load(currentPath) }
            await statusLoad
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
            fileContent = selectedFile?.content ?? ""
            savedContent = fileContent
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func save() async {
        guard let path = selectedFile?.path else { return }
        saving = true
        defer { saving = false }
        do {
            _ = try await client.writeIDEFile(path: path, content: fileContent)
            savedContent = fileContent
            await refreshLSP()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func refreshLSP() async {
        lspStatus = try? await client.lspStatus()
    }
}

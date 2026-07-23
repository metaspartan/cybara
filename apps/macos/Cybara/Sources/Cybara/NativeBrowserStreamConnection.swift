import AppKit
import Foundation

func nativeBrowserStreamURL(client: GatewayClient, pageID: String) -> URL? {
    let encoded = client.pathSegment(pageID)
    guard let endpoint = URL(
        string: "api/browser/tabs/\(encoded)/stream",
        relativeTo: client.baseURL
    )?.absoluteURL else {
        return nil
    }
    guard var components = URLComponents(
        url: endpoint,
        resolvingAgainstBaseURL: false
    ) else {
        return nil
    }
    components.scheme = components.scheme == "https" ? "wss" : "ws"
    components.queryItems = [
        URLQueryItem(name: "quality", value: "58"),
        URLQueryItem(name: "maxWidth", value: "1600"),
        URLQueryItem(name: "maxHeight", value: "1200"),
        URLQueryItem(name: "everyNthFrame", value: "1"),
    ]
    return components.url
}

@MainActor
final class NativeBrowserStreamConnection: ObservableObject {
    @Published private(set) var image: NSImage?
    @Published private(set) var connected = false
    @Published private(set) var error: String?

    private var task: URLSessionWebSocketTask?
    private var pageID: String?

    func connect(client: GatewayClient, pageID: String) {
        if self.pageID == pageID, connected { return }
        if self.pageID != pageID {
            image = nil
        }
        disconnect()
        guard let url = nativeBrowserStreamURL(client: client, pageID: pageID) else {
            error = "Invalid browser stream URL."
            return
        }
        var request = URLRequest(url: url)
        if let key = GatewayClient.loadAPIKey() {
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
        if let password = GatewayClient.loadGatewayPassword() {
            request.setValue(password, forHTTPHeaderField: "X-Cybara-Gateway-Password")
        }
        let next = URLSession.shared.webSocketTask(with: request)
        task = next
        self.pageID = pageID
        error = nil
        connected = true
        next.resume()
        receive(from: next)
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        pageID = nil
        connected = false
    }

    private func receive(from activeTask: URLSessionWebSocketTask) {
        activeTask.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.task === activeTask else { return }
                switch result {
                case .success(let message):
                    if case .data(let data) = message, let nextImage = NSImage(data: data) {
                        self.image = nextImage
                        self.error = nil
                    }
                    self.receive(from: activeTask)
                case .failure(let error):
                    if self.connected {
                        self.error = error.localizedDescription
                    }
                    self.connected = false
                    self.task = nil
                }
            }
        }
    }
}

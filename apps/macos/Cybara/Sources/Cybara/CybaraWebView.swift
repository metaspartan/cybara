import AppKit
import SwiftUI
import UserNotifications
import WebKit

struct CybaraWebView: NSViewRepresentable {
    let url: URL
    let gatewayPort: Int
    let managesGateway: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "cybaraNative")
        controller.addUserScript(
            WKUserScript(
                source: bootstrapScript(gatewayPort: gatewayPort, managesGateway: managesGateway),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false
            )
        )

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = webView
        webView.uiDelegate = context.coordinator
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.webView = webView
        webView.evaluateJavaScript(syncScript(gatewayPort: gatewayPort, managesGateway: managesGateway))
        if webView.url != url {
            webView.load(URLRequest(url: url))
        }
    }

    private func bootstrapScript(gatewayPort: Int, managesGateway: Bool) -> String {
        let managesGatewayScript = managesGateway ? "true" : "false"
        return """
        (function() {
          const post = function(payload) {
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.cybaraNative) {
              window.webkit.messageHandlers.cybaraNative.postMessage(payload);
            }
          };
          const callbacks = window.__cybaraNativeCallbacks || {};
          window.__cybaraNativeCallbacks = callbacks;
          window.__cybaraNativeResolve = function(id, value) {
            if (callbacks[id]) {
              callbacks[id](value);
              delete callbacks[id];
            }
          };
          const callAsync = function(type) {
            return new Promise(function(resolve) {
              const id = String(Date.now()) + "-" + Math.random().toString(16).slice(2);
              callbacks[id] = resolve;
              post({ type: type, callbackId: id });
            });
          };
          window.__CYBARA_NATIVE__ = {
            runtime: "cybara-native",
            platform: "macos",
            bridgeVersion: 1,
            gatewayPort: \(gatewayPort),
            managedGateway: \(managesGatewayScript),
            supportsDesktopUpdater: false,
            openExternal: function(url) {
              post({ type: "openExternal", url: String(url || "") });
            },
            notify: function(payload) {
              post({
                type: "notify",
                title: String((payload && payload.title) || "Cybara"),
                body: typeof payload?.body === "string" ? payload.body : ""
              });
            },
            requestNotificationPermission: function() {
              return callAsync("requestNotificationPermission");
            },
            notificationPermission: function() {
              return callAsync("notificationPermission");
            },
            openDirectoryDialog: function(options) {
              return new Promise(function(resolve) {
                const id = String(Date.now()) + "-" + Math.random().toString(16).slice(2);
                callbacks[id] = resolve;
                post({
                  type: "openDirectoryDialog",
                  callbackId: id,
                  defaultPath: typeof options?.defaultPath === "string" ? options.defaultPath : "",
                  title: typeof options?.title === "string" ? options.title : ""
                });
              });
            }
          };
          if (document.documentElement) {
            document.documentElement.dataset.runtime = "cybara-native";
            document.documentElement.dataset.platform = "macos";
          }
        })();
        """
    }

    private func syncScript(gatewayPort: Int, managesGateway: Bool) -> String {
        let managesGatewayScript = managesGateway ? "true" : "false"
        return """
        if (window.__CYBARA_NATIVE__) {
          window.__CYBARA_NATIVE__.gatewayPort = \(gatewayPort);
          window.__CYBARA_NATIVE__.managedGateway = \(managesGatewayScript);
        }
        if (document.documentElement) {
          document.documentElement.dataset.runtime = "cybara-native";
          document.documentElement.dataset.platform = "macos";
        }
        """
    }
}

final class Coordinator: NSObject, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    weak var webView: WKWebView?
    private nonisolated(unsafe) var reloadObserver: NSObjectProtocol?

    override init() {
        super.init()
        // Cmd-R / menu "Reload" → reload the web UI.
        reloadObserver = NotificationCenter.default.addObserver(
            forName: .cybaraReloadWebView, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.webView?.reload()
            }
        }
    }

    deinit {
        if let reloadObserver { NotificationCenter.default.removeObserver(reloadObserver) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "cybaraNative" else { return }
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }

        switch type {
        case "openExternal":
            guard let value = body["url"] as? String, let url = URL(string: value), !value.isEmpty else { return }
            NSWorkspace.shared.open(url)
        case "notify":
            let title = (body["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let finalTitle = (title?.isEmpty == false ? title! : "Cybara")
            let finalBody = (body["body"] as? String) ?? ""
            Task {
                await sendNotification(title: finalTitle, body: finalBody)
            }
        case "requestNotificationPermission":
            guard let callbackId = body["callbackId"] as? String else { return }
            requestNotificationPermission(callbackId: callbackId)
        case "notificationPermission":
            guard let callbackId = body["callbackId"] as? String else { return }
            resolveNotificationPermission(callbackId: callbackId)
        case "openDirectoryDialog":
            guard let callbackId = body["callbackId"] as? String else { return }
            let defaultPath = (body["defaultPath"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let title = (body["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            presentDirectoryDialog(callbackId: callbackId, defaultPath: defaultPath, title: title)
        default:
            break
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    private func sendNotification(title: String, body: String) async {
        let center = UNUserNotificationCenter.current()
        let permission = await currentNotificationPermission()
        if permission == "default" {
            _ = try? await center.requestAuthorization(options: [.alert, .badge, .sound])
        }

        let nextPermission = await currentNotificationPermission()
        guard nextPermission == "granted" else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        try? await center.add(request)
    }

    private func requestNotificationPermission(callbackId: String) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            Task { @MainActor in
                self.resolveCallback(callbackId: callbackId, value: granted ? "granted" : "denied")
            }
        }
    }

    private func resolveNotificationPermission(callbackId: String) {
        Task {
            let permission = await currentNotificationPermission()
            resolveCallback(callbackId: callbackId, value: permission)
        }
    }

    private func presentDirectoryDialog(callbackId: String, defaultPath: String?, title: String?) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Select"
        panel.message = "Choose a workspace folder for this Cybara session."
        panel.title = (title?.isEmpty == false ? title! : "Select Workspace")
        if let defaultPath, !defaultPath.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: defaultPath)
        }

        let response = panel.runModal()
        let selectedPath = response == .OK ? panel.url?.path : nil
        resolveCallback(callbackId: callbackId, value: selectedPath)
    }

    private func currentNotificationPermission() async -> String {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .ephemeral, .provisional:
            return "granted"
        case .denied:
            return "denied"
        case .notDetermined:
            return "default"
        @unknown default:
            return "default"
        }
    }

    private func resolveCallback(callbackId: String, value: String?) {
        let valueScript = value == nil ? "null" : jsString(value!)
        let script = "window.__cybaraNativeResolve && window.__cybaraNativeResolve(\(jsString(callbackId)), \(valueScript));"
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    private func jsString(_ value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
        return "\"\(escaped)\""
    }
}

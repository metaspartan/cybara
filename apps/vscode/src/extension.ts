import * as http from "http";
import * as vscode from "vscode";

function gatewayUrl(): string {
  const configured = vscode.workspace.getConfiguration("cybara").get<string>("gatewayUrl");
  return (configured || "http://localhost:4269").replace(/\/+$/, "");
}

function workspaceDir(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function checkGateway(base: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(`${base}/api/health`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(2000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function openRoute(route: string): Promise<void> {
  const base = gatewayUrl();
  const online = await checkGateway(base);
  if (!online) {
    const choice = await vscode.window.showWarningMessage(
      `Cybara gateway is not reachable at ${base}. Start it with 'cybara start'.`,
      "Open Settings"
    );
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand("workbench.action.openSettings", "cybara.gatewayUrl");
    }
    return;
  }
  const dir = workspaceDir();
  const query = dir ? `?workspace=${encodeURIComponent(dir)}` : "";
  await vscode.env.openExternal(vscode.Uri.parse(`${base}${route}${query}`));
}

export function activate(context: vscode.ExtensionContext): void {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "cybara.openDashboard";
  status.text = "$(hubot) Cybara";
  status.tooltip = "Open the Cybara dashboard";
  status.show();
  context.subscriptions.push(status);

  const refreshStatus = async (): Promise<void> => {
    const online = await checkGateway(gatewayUrl());
    status.text = online ? "$(hubot) Cybara" : "$(hubot) Cybara $(circle-slash)";
    status.tooltip = online ? "Open the Cybara dashboard" : "Cybara gateway offline — click to configure";
  };
  void refreshStatus();
  const interval = setInterval(() => void refreshStatus(), 30000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  context.subscriptions.push(
    vscode.commands.registerCommand("cybara.openDashboard", () => void openRoute("/")),
    vscode.commands.registerCommand("cybara.openChat", () => void openRoute("/chat")),
    vscode.commands.registerCommand("cybara.openIde", () => void openRoute("/ide"))
  );
}

export function deactivate(): void {}
